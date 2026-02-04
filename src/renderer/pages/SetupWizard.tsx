import React, { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import logo from '../assets/logo.png';

/**
 * Setup Wizard
 *
 * Simplified setup flow that only requires an API key.
 * Store information is automatically fetched from the cloud.
 *
 * @module renderer/pages/SetupWizard
 */

/**
 * Check if running in Electron environment
 */
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface SetupWizardProps {
  onComplete: () => void;
}

interface StoreInfo {
  storeId: string;
  storeName: string;
  companyName: string;
  timezone: string;
  lotteryEnabled?: boolean;
  lotteryBinCount?: number;
  /** Terminal connection type from cloud (Version 7.0) */
  connectionType?: string;
  /** POS system type from cloud (Version 7.0) */
  posType?: string;
}

/**
 * Setup wizard steps
 * Version 7.0: Removed 'watchPath' step - now auto-configured from terminal config
 */
type Step = 'welcome' | 'apiKey' | 'storeConfirm' | 'syncing' | 'complete';

function SetupWizard({ onComplete }: SetupWizardProps): React.ReactElement {
  const [step, setStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('https://api.nuvanaapp.com');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  // Version 7.0: watchPath and archivePath are now auto-configured from terminal config

  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [validating, setValidating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('');

  // Guard: redirect to dashboard if setup is already complete
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI
      .invoke<{ success: boolean; data?: { complete: boolean } }>('settings:isSetupComplete')
      .then((result) => {
        if (result?.data?.complete) {
          onComplete();
        }
      })
      .catch(() => {
        // If check fails, let the wizard proceed normally
      });
  }, [onComplete]);

  /**
   * Validate API key and fetch store information
   * Version 7.0: Now validates terminal configuration (MANDATORY)
   */
  const handleValidateApiKey = async (): Promise<void> => {
    setValidating(true);
    setError(null);

    // In dev mode without Electron, simulate successful validation
    if (!isElectron) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setStoreInfo({
        storeId: 'demo-store-001',
        storeName: 'Demo Store',
        companyName: 'Demo Company',
        timezone: 'America/New_York',
        lotteryEnabled: true,
        lotteryBinCount: 8,
        connectionType: 'FILE',
        posType: 'GILBARCO_PASSPORT',
      });
      setValidating(false);
      setStep('storeConfirm');
      return;
    }

    try {
      // Call settings:validateApiKey which validates and returns store info
      // Version 7.0: Also validates terminal configuration (MANDATORY)
      const result = await window.electronAPI.invoke<{
        success: boolean;
        data?: {
          valid: boolean;
          error?: string;
          terminalValidationErrors?: string[];
          store?: {
            storeId: string;
            storeName: string;
            companyId: string;
            companyName: string;
            timezone: string;
            features: string[];
            lottery?: { enabled: boolean; binCount: number };
            terminal?: {
              connection_type: string;
              pos_type: string;
            };
          };
        };
        error?: string;
      }>('settings:validateApiKey', { apiKey });

      // Check for terminal validation errors first (MANDATORY)
      if (
        result.data?.terminalValidationErrors &&
        result.data.terminalValidationErrors.length > 0
      ) {
        setError(`Store setup cannot continue: ${result.data.terminalValidationErrors.join('. ')}`);
        setValidating(false);
        return;
      }

      if (result.success && result.data?.valid && result.data?.store) {
        const store = result.data.store;
        setStoreInfo({
          storeId: store.storeId,
          storeName: store.storeName || 'Unknown Store',
          companyName: store.companyName || 'Unknown Company',
          timezone: store.timezone || 'UTC',
          lotteryEnabled: store.lottery?.enabled,
          lotteryBinCount: store.lottery?.binCount,
          connectionType: store.terminal?.connection_type,
          posType: store.terminal?.pos_type,
        });
        setStep('storeConfirm');
      } else {
        setError(
          result.data?.error || result.error || 'Invalid API key. Please check and try again.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate API key');
    } finally {
      setValidating(false);
    }
  };

  /**
   * Save configuration and trigger initial sync
   * Version 7.0: Watch paths are now auto-configured from terminal config
   */
  const handleSaveAndSync = async (): Promise<void> => {
    if (!storeInfo) return;

    setSyncing(true);
    setError(null);
    setStep('syncing');

    // In dev mode without Electron, simulate sync
    if (!isElectron) {
      setSyncStatus('Configuring POS connection...');
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSyncStatus('Syncing users...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSyncStatus('Syncing lottery data...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSyncStatus('Complete!');
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSyncing(false);
      setStep('complete');
      return;
    }

    try {
      // Step 1: Finalize configuration
      // Version 7.0: Watch paths already configured from terminal during API key validation
      setSyncStatus('Finalizing configuration...');
      const saveResult = await window.electronAPI.invoke<{
        success: boolean;
        data?: { success: boolean };
        error?: string;
        message?: string;
      }>('settings:updateDuringSetup', {
        // No xmlWatchFolder needed - auto-configured from terminal
      });

      if (!saveResult.success) {
        throw new Error(saveResult.message || saveResult.error || 'Failed to save configuration');
      }

      // Step 2: Sync users (use setup-specific endpoint - no auth required during setup)
      setSyncStatus('Syncing users from cloud...');
      const userSyncResult = await window.electronAPI.invoke<{
        success: boolean;
        data?: { success: boolean; synced?: number; error?: string };
        error?: string;
      }>('sync:syncUsersDuringSetup');

      if (!userSyncResult.success || !userSyncResult.data?.success) {
        console.warn('User sync warning:', userSyncResult.data?.error || userSyncResult.error);
        // Continue even if user sync fails - they can retry later
      } else {
        setSyncStatus(`Synced ${userSyncResult.data?.synced || 0} users`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Step 3: Sync lottery data (if enabled) - use setup-specific endpoints
      if (storeInfo.lotteryEnabled) {
        setSyncStatus('Syncing lottery bins...');
        await window.electronAPI.invoke('sync:syncBinsDuringSetup');

        setSyncStatus('Syncing lottery games...');
        await window.electronAPI.invoke('sync:syncGamesDuringSetup');
      }

      setSyncStatus('Setup complete!');
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setStep('storeConfirm'); // Go back to allow retry
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Complete setup and navigate to dashboard
   */
  const handleComplete = async (): Promise<void> => {
    // Mark setup as complete in backend before navigating away
    if (isElectron) {
      try {
        await window.electronAPI.invoke('settings:completeSetup');
      } catch (err) {
        console.error('Failed to mark setup complete:', err);
        // Continue anyway - user can restart if needed
      }
    }
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-8">
        {/* Setup Wizard Title - used for e2e test detection */}
        <span data-testid="setup-wizard-title" className="sr-only">
          Setup Wizard
        </span>

        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="text-center" data-testid="setup-step-welcome">
            <img src={logo} alt="Nuvana Logo" className="w-64 h-64 mx-auto mb-6" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Nuvana</h1>
            <p className="text-gray-600 mb-8">
              Connect your store to Nuvana Cloud for real-time data sync and back-office management.
            </p>
            <button
              onClick={() => setStep('apiKey')}
              className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              data-testid="setup-next-button"
            >
              Get Started
            </button>
          </div>
        )}

        {/* API Key Step */}
        {step === 'apiKey' && (
          <div data-testid="setup-step-apikey">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Enter Your API Key</h2>
            <p className="text-gray-600 mb-6">
              Your API key connects this device to your Nuvana account.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="nuvpos_sk_str_xxxxx_xxxxx"
                    className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg font-mono text-gray-900 bg-white placeholder:text-gray-400"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="api-key-input"
                    aria-label="API Key"
                    aria-describedby="api-key-hint"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 rounded"
                    data-testid="toggle-api-key-visibility"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p id="api-key-hint" className="text-xs text-gray-500 mt-1">
                  Find this in your Nuvana dashboard under Settings → Store Sync Keys
                </p>
              </div>

              {/* Advanced Options (collapsed by default) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-indigo-600 hover:text-indigo-700"
                  data-testid="toggle-advanced-options"
                >
                  {showAdvanced ? '− Hide advanced options' : '+ Advanced options'}
                </button>

                {showAdvanced && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      API URL (for custom deployments)
                    </label>
                    <input
                      type="url"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="https://api.nuvanaapp.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                )}
              </div>

              {error && (
                <div
                  className="p-3 rounded-lg bg-red-50 text-red-700 text-sm"
                  data-testid="api-key-error"
                >
                  {error}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setStep('welcome')}
                className="flex-1 py-3 px-6 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                data-testid="setup-back-button"
              >
                Back
              </button>
              <button
                onClick={handleValidateApiKey}
                disabled={validating || !apiKey.trim()}
                className="flex-1 py-3 px-6 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="validate-api-key-button"
              >
                {validating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                    Validating...
                  </span>
                ) : (
                  'Continue'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Store Confirmation Step */}
        {step === 'storeConfirm' && storeInfo && (
          <div>
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">API Key Verified!</h2>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-600">Store</span>
                <span className="font-medium text-gray-900">{storeInfo.storeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Company</span>
                <span className="font-medium text-gray-900">{storeInfo.companyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Timezone</span>
                <span className="font-medium text-gray-900">{storeInfo.timezone}</span>
              </div>
              {storeInfo.posType && (
                <div className="flex justify-between">
                  <span className="text-gray-600">POS System</span>
                  <span className="font-medium text-gray-900">
                    {storeInfo.posType.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              {storeInfo.connectionType && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Connection</span>
                  <span className="font-medium text-blue-600">{storeInfo.connectionType}</span>
                </div>
              )}
              {storeInfo.lotteryEnabled && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Lottery</span>
                  <span className="font-medium text-green-600">
                    Enabled ({storeInfo.lotteryBinCount} bins)
                  </span>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-600 mb-6">
              Is this the correct store? If not, please check your API key.
            </p>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm mb-4">{error}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setStoreInfo(null);
                  setError(null);
                  setStep('apiKey');
                }}
                className="flex-1 py-3 px-6 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSaveAndSync}
                disabled={syncing}
                className="flex-1 py-3 px-6 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {syncing ? 'Setting up...' : 'Complete Setup'}
              </button>
            </div>
          </div>
        )}

        {/* Version 7.0: watchPath step removed - paths auto-configured from terminal */}

        {/* Syncing Step */}
        {step === 'syncing' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-6">
              <svg className="animate-spin h-16 w-16 text-indigo-600" viewBox="0 0 24 24">
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
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Setting Up Your Store</h2>
            <p className="text-gray-600">{syncStatus || 'Please wait...'}</p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Setup Complete!</h1>
            <p className="text-gray-600 mb-8">
              Your store is now connected to Nuvana Cloud. You can start using the application.
            </p>
            <button
              onClick={handleComplete}
              className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {/* Progress Indicator */}
        {/* Version 7.0: Removed watchPath step - now 4 steps total */}
        <div className="mt-8 flex justify-center gap-2">
          {['welcome', 'apiKey', 'storeConfirm', 'complete'].map((s, i) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                ['welcome', 'apiKey', 'storeConfirm', 'syncing', 'complete'].indexOf(step) >= i
                  ? 'bg-indigo-600'
                  : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default SetupWizard;
