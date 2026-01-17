import React, { useState, useEffect, useCallback } from 'react';
import SetupWizard from './pages/SetupWizard';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import { LicenseExpired, LicenseWarning } from './components/license';

/**
 * Check if running in Electron environment
 */
const isElectron = typeof window !== 'undefined' && window.nuvanaAPI !== undefined;

/**
 * License state from main process
 */
interface LicenseState {
  valid: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  showWarning: boolean;
  inGracePeriod: boolean;
  status: string | null;
  lastChecked: string | null;
}

type Page = 'setup' | 'dashboard' | 'settings';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  // In dev mode without Electron, assume configured to allow testing UI
  const [isConfigured, setIsConfigured] = useState<boolean | null>(isElectron ? null : true);
  // License state
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null);
  const [isLoadingLicense, setIsLoadingLicense] = useState(isElectron);

  /**
   * Fetch license status from main process
   */
  const fetchLicenseStatus = useCallback(async () => {
    if (!isElectron) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke<{
        data?: LicenseState;
        error?: string;
      }>('license:getStatus');

      if (result.data) {
        setLicenseState(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch license status:', error);
    } finally {
      setIsLoadingLicense(false);
    }
  }, []);

  useEffect(() => {
    // Skip API calls if not in Electron (dev mode in browser)
    if (!isElectron) {
      setIsLoadingLicense(false);
      return;
    }

    // Check license status first
    fetchLicenseStatus();

    // Check if app is configured
    window.nuvanaAPI.getConfig().then((config) => {
      setIsConfigured(config.isConfigured);
      if (!config.isConfigured) {
        setCurrentPage('setup');
      }
    });

    // DEBUG: Check for store managers on app load
    Promise.all([
      window.electronAPI.invoke('auth:hasStoreManager'),
      window.electronAPI.invoke('auth:getUsers'),
    ])
      .then(([managerResult, usersResult]) => {
        console.log('=== STORE MANAGER CHECK ===');
        console.log('Result:', JSON.stringify(managerResult, null, 2));
        console.log('=== ALL USERS ===');
        console.log('Result:', JSON.stringify(usersResult, null, 2));

        // Show alert with results for easy viewing
        const managerData = (
          managerResult as { data?: { hasManager: boolean; managerCount: number } }
        ).data;
        const usersData =
          (usersResult as { data?: Array<{ name: string; role: string }> }).data || [];
        const storeManagers = usersData.filter((u: { role: string }) => u.role === 'store_manager');

        alert(
          `Store Manager Check:\n` +
            `Has Manager: ${managerData?.hasManager ?? 'N/A'}\n` +
            `Manager Count: ${managerData?.managerCount ?? 0}\n\n` +
            `All Users (${usersData.length}):\n` +
            usersData
              .map((u: { name: string; role: string }) => `- ${u.name} (${u.role})`)
              .join('\n') +
            `\n\nStore Managers:\n` +
            (storeManagers.length > 0
              ? storeManagers.map((u: { name: string }) => `- ${u.name}`).join('\n')
              : 'None found')
        );
      })
      .catch((err) => {
        console.error('Failed to check store manager:', err);
        alert('Failed to check store manager: ' + (err as Error).message);
      });

    // Listen for navigation events from main process
    const unsubscribeNav = window.nuvanaAPI.onNavigate((path) => {
      if (path === '/settings') {
        setCurrentPage('settings');
      } else if (path === '/dashboard') {
        setCurrentPage('dashboard');
      }
    });

    // Listen for license status changes
    let unsubscribeLicense: (() => void) | undefined;
    try {
      unsubscribeLicense = window.electronAPI.on('license:statusChanged', () => {
        fetchLicenseStatus();
      });
    } catch {
      // Channel might not be available in some environments
    }

    return () => {
      unsubscribeNav();
      unsubscribeLicense?.();
    };
  }, [fetchLicenseStatus]);

  const handleSetupComplete = () => {
    setIsConfigured(true);
    setCurrentPage('dashboard');
    // Re-fetch license after setup (API key validation would have updated it)
    fetchLicenseStatus();
  };

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
  };

  /**
   * Handle successful license retry
   */
  const handleLicenseRetrySuccess = useCallback(() => {
    fetchLicenseStatus();
  }, [fetchLicenseStatus]);

  // Loading state
  if (isConfigured === null || isLoadingLicense) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // License expired - show lock screen (blocks all functionality)
  // Only show if license state is loaded and license is explicitly invalid
  if (licenseState && !licenseState.valid) {
    return (
      <LicenseExpired
        expiresAt={licenseState.expiresAt}
        onRetrySuccess={handleLicenseRetrySuccess}
      />
    );
  }

  // Determine if we should show the license warning
  const showLicenseWarning = licenseState?.showWarning && licenseState.daysRemaining !== null;

  // Render current page with optional license warning
  const renderPage = () => {
    switch (currentPage) {
      case 'setup':
        return <SetupWizard onComplete={handleSetupComplete} />;
      case 'settings':
        return <Settings onBack={() => handleNavigate('dashboard')} />;
      case 'dashboard':
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  // Wrap with license warning banner if needed
  if (showLicenseWarning && licenseState) {
    return (
      <div className="flex flex-col h-screen">
        <LicenseWarning
          daysRemaining={licenseState.daysRemaining!}
          inGracePeriod={licenseState.inGracePeriod}
        />
        <div className="flex-1 overflow-auto">{renderPage()}</div>
      </div>
    );
  }

  return renderPage();
}

export default App;
