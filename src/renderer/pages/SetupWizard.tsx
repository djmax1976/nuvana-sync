import React, { useState } from "react";

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = "welcome" | "connection" | "watchPath" | "complete";

function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [config, setConfig] = useState({
    apiUrl: "",
    apiKey: "",
    storeId: "",
    watchPath: "",
    archivePath: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const result = await window.nuvanaSyncAPI.testConnection(config);
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    await window.nuvanaSyncAPI.saveConfig(config);
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-8">
        {step === "welcome" && (
          <div className="text-center">
            <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Welcome to Nuvana Sync
            </h1>
            <p className="text-gray-600 mb-8">
              This application will sync your POS data to the cloud
              automatically.
            </p>
            <button
              onClick={() => setStep("connection")}
              className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
            >
              Get Started
            </button>
          </div>
        )}

        {step === "connection" && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              Connect to Nuvana Cloud
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API URL
                </label>
                <input
                  type="url"
                  value={config.apiUrl}
                  onChange={(e) =>
                    setConfig({ ...config, apiUrl: e.target.value })
                  }
                  placeholder="https://api.nuvana.cloud"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) =>
                    setConfig({ ...config, apiKey: e.target.value })
                  }
                  placeholder="sk_live_xxxxxxxxxxxxx"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Provided by your account manager
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store ID
                </label>
                <input
                  type="text"
                  value={config.storeId}
                  onChange={(e) =>
                    setConfig({ ...config, storeId: e.target.value })
                  }
                  placeholder="store-001"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-lg ${
                    testResult.success
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {testResult.message}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setStep("welcome")}
                className="flex-1 py-3 px-6 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleTestConnection}
                disabled={testing || !config.apiUrl || !config.apiKey}
                className="flex-1 py-3 px-6 bg-gray-100 rounded-lg font-medium text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {testing ? "Testing..." : "Test Connection"}
              </button>
              <button
                onClick={() => setStep("watchPath")}
                disabled={!testResult?.success}
                className="flex-1 py-3 px-6 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === "watchPath" && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              Configure File Watching
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  NAXML Watch Path
                </label>
                <input
                  type="text"
                  value={config.watchPath}
                  onChange={(e) =>
                    setConfig({ ...config, watchPath: e.target.value })
                  }
                  placeholder="Z:\Gilbarco\Export\NAXML"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Path where Gilbarco Passport exports NAXML files
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Archive Path (Optional)
                </label>
                <input
                  type="text"
                  value={config.archivePath}
                  onChange={(e) =>
                    setConfig({ ...config, archivePath: e.target.value })
                  }
                  placeholder="Z:\Gilbarco\Export\NAXML\Processed"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Processed files will be moved here
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setStep("connection")}
                className="flex-1 py-3 px-6 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={!config.watchPath}
                className="flex-1 py-3 px-6 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                Start Syncing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SetupWizard;
