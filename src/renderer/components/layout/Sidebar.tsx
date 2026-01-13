/**
 * Sidebar Navigation Component
 *
 * Main navigation sidebar with links to all sections.
 * Highlights active route using React Router.
 *
 * @module renderer/components/layout/Sidebar
 */

import React from 'react';
import { NavLink } from 'react-router-dom';

interface SidebarProps {
  onNavigate?: () => void;
}

interface NavItem {
  name: string;
  path: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    name: 'Dashboard',
    path: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    name: 'Shifts',
    path: '/shifts',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    name: 'Transactions',
    path: '/transactions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
        />
      </svg>
    ),
  },
  {
    name: 'Reports',
    path: '/reports',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },
  {
    name: 'Settings',
    path: '/settings',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    ),
  },
];

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <div className="flex flex-col h-full w-64 bg-gray-900 text-white">
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-gray-800">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">N</span>
          </div>
          <span className="font-semibold text-lg">Nuvana</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            {item.icon}
            <span className="ml-3">{item.name}</span>
          </NavLink>
        ))}
      </nav>

      {/* Sync Status Footer */}
      <div className="px-4 py-4 border-t border-gray-800">
        <SyncStatusIndicator />
      </div>
    </div>
  );
}

/**
 * Check if running in Electron environment
 */
const isElectron = typeof window !== 'undefined' && window.nuvanaAPI !== undefined;

/**
 * Sync status indicator showing file watcher state
 */
function SyncStatusIndicator() {
  const [stats, setStats] = React.useState<{
    filesProcessed: number;
    filesErrored: number;
    isWatching: boolean;
  } | null>(null);

  React.useEffect(() => {
    // Skip API calls if not in Electron (dev mode in browser)
    if (!isElectron) {
      // Set mock stats for dev mode
      setStats({
        filesProcessed: 42,
        filesErrored: 0,
        isWatching: true,
      });
      return;
    }

    // Initial fetch
    window.nuvanaAPI.getStats().then(setStats);

    // Subscribe to sync status updates
    const unsubscribe = window.nuvanaAPI.onSyncStatus(() => {
      window.nuvanaAPI.getStats().then(setStats);
    });

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      window.nuvanaAPI.getStats().then(setStats);
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  if (!stats) {
    return null;
  }

  return (
    <div className="text-sm">
      <div className="flex items-center space-x-2">
        <div
          className={`w-2 h-2 rounded-full ${stats.isWatching ? 'bg-green-500' : 'bg-yellow-500'}`}
        />
        <span className="text-gray-400">{stats.isWatching ? 'Watching' : 'Paused'}</span>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {stats.filesProcessed} files processed
        {stats.filesErrored > 0 && (
          <span className="text-red-400 ml-2">{stats.filesErrored} errors</span>
        )}
      </div>
    </div>
  );
}
