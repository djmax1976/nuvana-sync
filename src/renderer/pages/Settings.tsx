/**
 * Settings Page Component
 *
 * Configuration UI for Nuvana Sync settings.
 *
 * @module renderer/pages/Settings
 * @security SEC-014: Client-side input validation
 */

import React, { useState, useEffect, useCallback } from "react";

/**
 * SEC-014: Client-side validation patterns
 */
const VALIDATION = {
  URL_PATTERN: /^https:\/\/.+/,
  API_KEY_PATTERN: /^[a-zA-Z0-9_\-.]+$/,
  STORE_ID_PATTERN: /^[a-zA-Z0-9\-_]+$/,
  PATH_FORBIDDEN_PATTERN: /\.\.|[<>"|?*]/,
  POLL_MIN: 1,
  POLL_MAX: 3600,
  MAX_PATH_LENGTH: 500,
  MAX_URL_LENGTH: 500,
  MAX_API_KEY_LENGTH: 500,
  MAX_STORE_ID_LENGTH: 100,
};

interface SettingsProps {
  onBack: () => void;
}

interface Config {
  apiUrl: string;
  apiKey: string;
  storeId: string;
  watchPath: string;
  archivePath: string;
  errorPath: string;
  pollInterval: number;
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
  apiUrl?: string;
  apiKey?: string;
  storeId?: string;
  watchPath?: string;
  archivePath?: string;
  errorPath?: string;
  pollInterval?: string;
}

/**
 * SEC-014: Validate URL format
 */
function validateUrl(url: string): string | undefined {
  if (!url) return undefined; // Allow empty during editing
  if (url.length > VALIDATION.MAX_URL_LENGTH) {
    return "URL is too long (max 500 characters)";
  }
  if (!VALIDATION.URL_PATTERN.test(url)) {
    return "URL must start with https://";
  }
  return undefined;
}

/**
 * SEC-014: Validate API key format
 */
function validateApiKey(key: string): string | undefined {
  if (!key) return undefined;
  if (key.length > VALIDATION.MAX_API_KEY_LENGTH) {
    return "API key is too long";
  }
  if (!VALIDATION.API_KEY_PATTERN.test(key)) {
    return "API key contains invalid characters";
  }
  return undefined;
}

/**
 * SEC-014: Validate store ID format
 */
function validateStoreId(storeId: string): string | undefined {
  if (!storeId) return undefined;
  if (storeId.length > VALIDATION.MAX_STORE_ID_LENGTH) {
    return "Store ID is too long";
  }
  if (!VALIDATION.STORE_ID_PATTERN.test(storeId)) {
    return "Store ID contains invalid characters";
  }
  return undefined;
}

/**
 * SEC-014: Validate path (prevent path traversal)
 */
function validatePath(path: string): string | undefined {
  if (!path) return undefined;
  if (path.length > VALIDATION.MAX_PATH_LENGTH) {
    return "Path is too long (max 500 characters)";
  }
  if (VALIDATION.PATH_FORBIDDEN_PATTERN.test(path)) {
    return "Path contains forbidden characters or sequences";
  }
  return undefined;
}

/**
 * SEC-014: Validate poll interval
 */
function validatePollInterval(interval: number): string | undefined {
  if (isNaN(interval)) {
    return "Poll interval must be a number";
  }
  if (interval < VALIDATION.POLL_MIN || interval > VALIDATION.POLL_MAX) {
    return `Poll interval must be between ${VALIDATION.POLL_MIN} and ${VALIDATION.POLL_MAX} seconds`;
  }
  return undefined;
}

/**
 * Validate all form fields
 */
function validateForm(config: Config): ValidationErrors {
  return {
    apiUrl: validateUrl(config.apiUrl),
    apiKey: validateApiKey(config.apiKey),
    storeId: validateStoreId(config.storeId),
    watchPath: validatePath(config.watchPath),
    archivePath: validatePath(config.archivePath),
    errorPath: validatePath(config.errorPath),
    pollInterval: validatePollInterval(config.pollInterval),
  };
}

/**
 * Check if form has any errors
 */
function hasErrors(errors: ValidationErrors): boolean {
  return Object.values(errors).some((error) => error !== undefined);
}

function Settings({ onBack }: SettingsProps): React.ReactElement {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    window.nuvanaSyncAPI.getConfig().then((response) => {
      if (response && response.config) {
        setConfig(response.config);
      }
    });
  }, []);

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
        case "apiUrl":
          newErrors.apiUrl = validateUrl(value as string);
          break;
        case "apiKey":
          newErrors.apiKey = validateApiKey(value as string);
          break;
        case "storeId":
          newErrors.storeId = validateStoreId(value as string);
          break;
        case "watchPath":
          newErrors.watchPath = validatePath(value as string);
          break;
        case "archivePath":
          newErrors.archivePath = validatePath(value as string);
          break;
        case "errorPath":
          newErrors.errorPath = validatePath(value as string);
          break;
        case "pollInterval":
          newErrors.pollInterval = validatePollInterval(value as number);
          break;
      }
      setErrors(newErrors);
    },
    [config, errors]
  );

  const handleSave = async (): Promise<void> => {
    if (!config) return;

    // SEC-014: Validate all fields before saving
    const validationErrors = validateForm(config);
    setErrors(validationErrors);

    if (hasErrors(validationErrors)) {
      setSaveError("Please fix validation errors before saving");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const result = await window.nuvanaSyncAPI.saveConfig(config);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError(result.error || "Failed to save configuration");
      }
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "An error occurred"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (): Promise<void> => {
    if (!config) return;

    // SEC-014: Validate connection fields before testing
    const urlError = validateUrl(config.apiUrl);
    const keyError = validateApiKey(config.apiKey);
    const storeError = validateStoreId(config.storeId);

    if (urlError || keyError || storeError) {
      setTestResult({
        success: false,
        message: "Please fix validation errors before testing",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const result = await window.nuvanaSyncAPI.testConnection(config);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            aria-label="Go back"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        </div>
      </header>

      <main className="p-6 max-w-2xl mx-auto">
        {/* Connection Section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Connection
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="apiUrl"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                API URL
              </label>
              <input
                id="apiUrl"
                type="url"
                value={config.apiUrl}
                onChange={(e) => updateConfig("apiUrl", e.target.value)}
                maxLength={VALIDATION.MAX_URL_LENGTH}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.apiUrl ? "border-red-500" : "border-gray-300"
                }`}
                placeholder="https://api.example.com"
              />
              {errors.apiUrl && (
                <p className="text-sm text-red-500 mt-1">{errors.apiUrl}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="apiKey"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                API Key
              </label>
              <input
                id="apiKey"
                type="password"
                value={config.apiKey}
                onChange={(e) => updateConfig("apiKey", e.target.value)}
                maxLength={VALIDATION.MAX_API_KEY_LENGTH}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.apiKey ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.apiKey && (
                <p className="text-sm text-red-500 mt-1">{errors.apiKey}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="storeId"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Store ID
              </label>
              <input
                id="storeId"
                type="text"
                value={config.storeId}
                onChange={(e) => updateConfig("storeId", e.target.value)}
                maxLength={VALIDATION.MAX_STORE_ID_LENGTH}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.storeId ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.storeId && (
                <p className="text-sm text-red-500 mt-1">{errors.storeId}</p>
              )}
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg ${
                  testResult.success
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
                role="alert"
              >
                {testResult.message}
              </div>
            )}

            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </section>

        {/* File Watching Section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            File Watching
          </h2>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="watchPath"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Watch Path
              </label>
              <input
                id="watchPath"
                type="text"
                value={config.watchPath}
                onChange={(e) => updateConfig("watchPath", e.target.value)}
                maxLength={VALIDATION.MAX_PATH_LENGTH}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.watchPath ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.watchPath && (
                <p className="text-sm text-red-500 mt-1">{errors.watchPath}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="archivePath"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Archive Path
              </label>
              <input
                id="archivePath"
                type="text"
                value={config.archivePath}
                onChange={(e) => updateConfig("archivePath", e.target.value)}
                maxLength={VALIDATION.MAX_PATH_LENGTH}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.archivePath ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.archivePath && (
                <p className="text-sm text-red-500 mt-1">
                  {errors.archivePath}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="errorPath"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Error Path
              </label>
              <input
                id="errorPath"
                type="text"
                value={config.errorPath}
                onChange={(e) => updateConfig("errorPath", e.target.value)}
                maxLength={VALIDATION.MAX_PATH_LENGTH}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.errorPath ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.errorPath && (
                <p className="text-sm text-red-500 mt-1">{errors.errorPath}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="pollInterval"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Poll Interval (seconds)
              </label>
              <input
                id="pollInterval"
                type="number"
                min={VALIDATION.POLL_MIN}
                max={VALIDATION.POLL_MAX}
                value={config.pollInterval}
                onChange={(e) =>
                  updateConfig("pollInterval", parseInt(e.target.value, 10) || 5)
                }
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  errors.pollInterval ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.pollInterval && (
                <p className="text-sm text-red-500 mt-1">
                  {errors.pollInterval}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* File Types Section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            File Types
          </h2>

          <div className="space-y-3">
            {[
              { key: "pjr", label: "PJR - Transaction Journal" },
              { key: "fgm", label: "FGM - Fuel Grade Movement" },
              { key: "msm", label: "MSM - Miscellaneous Summary" },
              { key: "fpm", label: "FPM - Fuel Product Movement" },
              { key: "mcm", label: "MCM - Merchandise Code Movement" },
              { key: "tlm", label: "TLM - Tax Level Movement" },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={
                    config.enabledFileTypes[
                      key as keyof typeof config.enabledFileTypes
                    ]
                  }
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      enabledFileTypes: {
                        ...config.enabledFileTypes,
                        [key]: e.target.checked,
                      },
                    })
                  }
                  className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Behavior Section */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Behavior</h2>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.startOnLogin}
                onChange={(e) =>
                  setConfig({ ...config, startOnLogin: e.target.checked })
                }
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">
                Start on Windows login
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.minimizeToTray}
                onChange={(e) =>
                  setConfig({ ...config, minimizeToTray: e.target.checked })
                }
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">
                Minimize to system tray
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.showNotifications}
                onChange={(e) =>
                  setConfig({ ...config, showNotifications: e.target.checked })
                }
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Show notifications</span>
            </label>
          </div>
        </section>

        {/* Error Display */}
        {saveError && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4" role="alert">
            {saveError}
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving || hasErrors(errors)}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
            saved
              ? "bg-green-600 text-white"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          } disabled:opacity-50`}
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
        </button>
      </main>
    </div>
  );
}

export default Settings;
