import React, { useState, useEffect } from 'react';

interface DashboardProps {
  onNavigate: (page: 'settings') => void;
}

/**
 * Sync stats as received from IPC
 * Note: Date objects are serialized as ISO strings over IPC
 */
interface SyncStats {
  filesProcessed: number;
  filesErrored: number;
  lastSyncTime: Date | string | null;
  isWatching: boolean;
}

/**
 * File record as received from IPC
 * Note: Date objects are serialized as ISO strings over IPC
 */
interface FileRecord {
  filePath: string;
  fileName: string;
  status: 'queued' | 'processing' | 'success' | 'error';
  timestamp: Date | string;
  error?: string;
  documentType?: string;
}

function Dashboard({ onNavigate }: DashboardProps) {
  const [stats, setStats] = useState<SyncStats>({
    filesProcessed: 0,
    filesErrored: 0,
    lastSyncTime: null,
    isWatching: false,
  });
  const [recentFiles, setRecentFiles] = useState<FileRecord[]>([]);
  const [isPaused, setIsPaused] = useState(false);

  const loadData = async () => {
    const [statsData, filesData] = await Promise.all([
      window.nuvanaSyncAPI.getStats(),
      window.nuvanaSyncAPI.getRecentFiles(),
    ]);
    setStats(statsData);
    setRecentFiles(filesData);
    setIsPaused(!statsData.isWatching);
  };

  useEffect(() => {
    // Load initial data
    loadData();

    // Poll for updates
    const interval = setInterval(loadData, 5000);

    // Listen for sync status events
    const unsubscribe = window.nuvanaSyncAPI.onSyncStatus((_data) => {
      loadData();
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTogglePause = async () => {
    const result = await window.nuvanaSyncAPI.togglePause();
    setIsPaused(result.paused);
  };

  const handleTriggerSync = async () => {
    await window.nuvanaSyncAPI.triggerSync();
    loadData();
  };

  const formatTime = (timestamp: Date | string | null) => {
    if (!timestamp) return 'Never';
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    return date.toLocaleTimeString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span className="text-green-500">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        );
      case 'error':
        return (
          <span className="text-red-500">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        );
      case 'processing':
        return (
          <span className="text-yellow-500 animate-spin">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        );
      default:
        return (
          <span className="text-gray-400">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Nuvana Sync</h1>
          <button
            onClick={() => onNavigate('settings')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      <main className="p-6">
        {/* Status Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  stats.isWatching ? 'bg-green-500' : 'bg-gray-400'
                }`}
              />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {stats.isWatching ? 'Connected' : 'Paused'}
                </div>
                <div className="text-xs text-gray-500">Sync Status</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6 text-indigo-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {formatTime(stats.lastSyncTime)}
                </div>
                <div className="text-xs text-gray-500">Last Sync</div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-4">Today's Activity</h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-3xl font-bold text-gray-900">{stats.filesProcessed}</div>
              <div className="text-sm text-gray-500">Files Processed</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-red-600">{stats.filesErrored}</div>
              <div className="text-sm text-gray-500">Errors</div>
            </div>
          </div>
        </div>

        {/* Recent Files */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-sm font-medium text-gray-900">Recent Files</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentFiles.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">No files processed yet</div>
            ) : (
              recentFiles.slice(0, 10).map((file, index) => (
                <div key={index} className="px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(file.status)}
                    <div>
                      <div className="text-sm font-medium text-gray-900">{file.fileName}</div>
                      {file.error && <div className="text-xs text-red-500">{file.error}</div>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">{formatTime(file.timestamp)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleTogglePause}
            className={`flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 ${
              isPaused
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
            }`}
          >
            {isPaused ? (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
                Resume Sync
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                Pause Sync
              </>
            )}
          </button>
          <button
            onClick={handleTriggerSync}
            className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Sync Now
          </button>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
