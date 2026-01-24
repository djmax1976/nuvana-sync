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
          };
        };
        error?: string;
        message?: string;
      }>('settings:validateApiKey', { apiKey: config.apiKey });

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
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

      <main className="p-6 max-w-2xl mx-auto">
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

        {/* File Watching Section */}
        <section className="bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">File Watching</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="watchPath" className="block text-sm font-medium text-foreground mb-1">
                NAXML Watch Folder
              </label>
              <input
                id="watchPath"
                type="text"
                value={config.watchPath}
                onChange={(e) => updateConfig('watchPath', e.target.value)}
                maxLength={VALIDATION.MAX_PATH_LENGTH}
                placeholder="Z:\Gilbarco\Export\NAXML"
                className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent ${
                  errors.watchPath ? 'border-destructive' : 'border-input'
                }`}
              />
              {errors.watchPath && (
                <p className="text-sm text-destructive mt-1">{errors.watchPath}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="pollInterval"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Sync Interval (seconds)
              </label>
              <input
                id="pollInterval"
                type="number"
                min={VALIDATION.POLL_MIN}
                max={VALIDATION.POLL_MAX}
                value={config.pollInterval}
                onChange={(e) => updateConfig('pollInterval', parseInt(e.target.value, 10) || 60)}
                className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent ${
                  errors.pollInterval ? 'border-destructive' : 'border-input'
                }`}
              />
              {errors.pollInterval && (
                <p className="text-sm text-destructive mt-1">{errors.pollInterval}</p>
              )}
            </div>
          </div>
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

        {/* File Types Section */}
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

        {/* Reprocess XML Files Section */}
        <section className="bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Reprocess XML Files</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Clear processed file tracking and reprocess XML files from the watch folder. Use this if
            files were processed before a parser fix was applied.
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

        {/* Fuel Data Reset Section */}
        <section className="bg-card rounded-xl p-6 border border-orange-500/30">
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
      </main>
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
