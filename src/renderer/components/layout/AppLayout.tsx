/**
 * Application Layout Component
 *
 * Main layout wrapper with sidebar navigation and content area.
 * Uses the MyStore dashboard layout design for the Electron desktop app.
 *
 * @module renderer/components/layout/AppLayout
 *
 * @security FE-001: STATE_MANAGEMENT - Fetches store timezone from backend settings
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { MyStoreSidebar } from './MyStoreSidebar';
import { Header } from './Header';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';
import { Toaster } from '../ui/toaster';
import { Menu } from 'lucide-react';
import { ClientAuthProvider } from '../../contexts/ClientAuthContext';
import { StoreProvider, type StoreContextValue } from '../../contexts/StoreContext';
import { ipcClient } from '../../lib/api/ipc-client';

/**
 * Check if running in Electron environment
 * In dev mode with Vite in browser, window.nuvanaAPI won't exist
 */
const isElectron = typeof window !== 'undefined' && window.nuvanaAPI !== undefined;

/**
 * Default store context value for development/fallback
 * Uses America/New_York as default (matches backend default in settings.service.ts)
 */
const defaultStoreValue: StoreContextValue = {
  storeId: 'dev-store',
  timezone: 'America/New_York',
  storeName: 'Development Store',
  companyId: null,
  clientId: null,
};

/**
 * Settings response shape from settings:get IPC
 * Only includes fields needed for StoreContext
 */
interface SettingsResponse {
  storeId?: string;
  storeName?: string;
  timezone?: string;
  companyId?: string;
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // In non-Electron dev mode, assume configured to allow testing UI
  const [isConfigured, setIsConfigured] = useState<boolean | null>(isElectron ? null : true);
  // Store context state - populated from settings:get
  const [storeSettings, setStoreSettings] = useState<SettingsResponse | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Skip config check if not in Electron (dev mode in browser)
    if (!isElectron) {
      return;
    }

    // Check if app is configured
    window.nuvanaAPI.getConfig().then((config) => {
      setIsConfigured(config.isConfigured);
      if (!config.isConfigured && location.pathname !== '/setup') {
        navigate('/setup', { replace: true });
      }
    });

    // Fetch full settings to get store timezone
    // FE-001: STATE_MANAGEMENT - Centralized timezone from backend
    ipcClient
      .invoke<SettingsResponse | null>('settings:get')
      .then((settings) => {
        if (settings) {
          setStoreSettings(settings);
        }
      })
      .catch((err) => {
        // Log but don't fail - will use default timezone
        console.warn('Failed to fetch settings for timezone:', err);
      });

    // Listen for navigation events from main process (tray menu)
    const unsubscribe = window.nuvanaAPI.onNavigate((path) => {
      navigate(path);
    });

    return unsubscribe;
  }, [navigate, location.pathname]);

  /**
   * Build store context value from fetched settings
   * Falls back to defaults if settings not loaded
   *
   * FE-001: STATE_MANAGEMENT - Memoized to prevent unnecessary re-renders
   */
  const storeContextValue: StoreContextValue = useMemo(() => {
    if (!storeSettings) {
      return defaultStoreValue;
    }

    return {
      storeId: storeSettings.storeId || defaultStoreValue.storeId,
      timezone: storeSettings.timezone || defaultStoreValue.timezone,
      storeName: storeSettings.storeName || defaultStoreValue.storeName,
      companyId: storeSettings.companyId || null,
      clientId: null, // Not needed for current use cases
    };
  }, [storeSettings]);

  // Loading state while checking configuration
  if (isConfigured === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <ClientAuthProvider>
      <StoreProvider value={storeContextValue}>
        {/* Toast notifications container */}
        <Toaster />
        <div className="flex h-screen overflow-hidden" data-testid="app-layout">
          {/* Desktop Sidebar */}
          <aside className="hidden xl:block">
            <MyStoreSidebar />
          </aside>

          {/* Mobile Sidebar Sheet */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent
              side="left"
              className="w-64 p-0"
              onInteractOutside={() => setSidebarOpen(false)}
            >
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Navigation menu for Nuvana dashboard
              </SheetDescription>
              <MyStoreSidebar onNavigate={() => setSidebarOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Main Content Area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Mobile Header with Menu Button */}
            <div className="xl:hidden">
              <div className="flex h-16 items-center justify-between border-b bg-background px-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(true)}
                  data-testid="sidebar-toggle"
                >
                  <Menu className="h-5 w-5" />
                </Button>
                <h2 className="text-lg font-bold text-foreground">Nuvana</h2>
                <div className="flex-1" />
                <Header variant="controls-only" />
              </div>
            </div>

            {/* Desktop Header */}
            <div className="hidden xl:block">
              <Header variant="full" />
            </div>

            {/* Page Content */}
            <main className="flex-1 overflow-y-auto bg-background p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </StoreProvider>
    </ClientAuthProvider>
  );
}
