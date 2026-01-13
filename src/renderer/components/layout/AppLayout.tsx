/**
 * Application Layout Component
 *
 * Main layout wrapper with sidebar navigation and content area.
 * Uses the MyStore dashboard layout design for the Electron desktop app.
 *
 * @module renderer/components/layout/AppLayout
 */

import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { MyStoreSidebar } from './MyStoreSidebar';
import { Header } from './Header';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { Button } from '../ui/button';
import { Menu } from 'lucide-react';
import { ClientAuthProvider } from '../../contexts/ClientAuthContext';
import { StoreProvider, type StoreContextValue } from '../../contexts/StoreContext';

/**
 * Check if running in Electron environment
 * In dev mode with Vite in browser, window.nuvanaAPI won't exist
 */
const isElectron = typeof window !== 'undefined' && window.nuvanaAPI !== undefined;

/**
 * Default store context value for development/fallback
 */
const defaultStoreValue: StoreContextValue = {
  storeId: 'dev-store',
  timezone: 'America/Denver',
  storeName: 'Development Store',
  companyId: null,
  clientId: null,
};

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // In non-Electron dev mode, assume configured to allow testing UI
  const [isConfigured, setIsConfigured] = useState<boolean | null>(isElectron ? null : true);
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

    // Listen for navigation events from main process (tray menu)
    const unsubscribe = window.nuvanaAPI.onNavigate((path) => {
      navigate(path);
    });

    return unsubscribe;
  }, [navigate, location.pathname]);

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
      <StoreProvider value={defaultStoreValue}>
        <div
          className="flex h-screen overflow-hidden"
          data-testid="app-layout"
        >
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block">
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
            <div className="lg:hidden">
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
            <div className="hidden lg:block">
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
