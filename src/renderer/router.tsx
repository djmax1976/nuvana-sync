/**
 * React Router Configuration
 *
 * Defines application routes for the Electron renderer.
 * Replaces Next.js routing with React Router for desktop app.
 *
 * @module renderer/router
 */

import React, { Suspense, lazy } from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LoadingSpinner } from './components/ui/LoadingSpinner';
import { ProtectedPage } from './components/auth/ProtectedPage';

// ============================================================================
// Lazy-loaded Pages
// ============================================================================

// Core pages - MyStore dashboard as main dashboard
const MyStoreDashboard = lazy(() =>
  import('./pages/MyStoreDashboard').then((m) => ({ default: m.MyStoreDashboard }))
);
const ShiftsPage = lazy(() => import('./pages/ShiftsPage'));
const ShiftDetailPage = lazy(() => import('./pages/ShiftDetailPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

// Placeholder pages for new routes
const ClockInOutPage = lazy(() => import('./pages/ClockInOutPage'));
const LotteryPage = lazy(() => import('./pages/LotteryPage'));
const LotteryGamesPage = lazy(() => import('./pages/LotteryGamesPage'));
const POSIntegrationPage = lazy(() => import('./pages/POSIntegrationPage'));
const TerminalsPage = lazy(() => import('./pages/TerminalsPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));

// Wizard pages
const ShiftEndPage = lazy(() => import('./pages/ShiftEndPage'));
const DayClosePage = lazy(() => import('./pages/DayClosePage'));
const TerminalShiftPage = lazy(() => import('./pages/TerminalShiftPage'));

// Sync Monitor page
const SyncMonitorPage = lazy(() => import('./pages/SyncMonitorPage'));

// Setup wizard (not lazy - needed immediately)
import SetupWizard from './pages/SetupWizard';

// ============================================================================
// Loading Fallback
// ============================================================================

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <LoadingSpinner size="lg" />
    </div>
  );
}

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Hash router is used for Electron compatibility
 * (file:// protocol doesn't support browser history API)
 */
const router = createHashRouter([
  {
    path: '/setup',
    element: <SetupWizard onComplete={() => (window.location.href = '#/')} />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<PageLoader />}>
            <MyStoreDashboard />
          </Suspense>
        ),
      },
      {
        path: 'dashboard',
        element: <Navigate to="/" replace />,
      },
      {
        path: 'mystore',
        element: <Navigate to="/" replace />,
      },
      {
        path: 'clock-in-out',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ClockInOutPage />
          </Suspense>
        ),
      },
      {
        path: 'lottery',
        element: (
          <Suspense fallback={<PageLoader />}>
            <LotteryPage />
          </Suspense>
        ),
      },
      {
        path: 'lottery/games',
        element: (
          <Suspense fallback={<PageLoader />}>
            <LotteryGamesPage />
          </Suspense>
        ),
      },
      {
        path: 'pos-integration',
        element: (
          <Suspense fallback={<PageLoader />}>
            <POSIntegrationPage />
          </Suspense>
        ),
      },
      {
        path: 'terminals',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TerminalsPage />
          </Suspense>
        ),
      },
      {
        path: 'employees',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ProtectedPage
              requiredRole="store_manager"
              title="Employee Management"
              description="Enter your Store Manager PIN to access employee management."
            >
              <EmployeesPage />
            </ProtectedPage>
          </Suspense>
        ),
      },
      {
        path: 'shifts',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ShiftsPage />
          </Suspense>
        ),
      },
      {
        path: 'shifts/:shiftId',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ShiftDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'transactions',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TransactionsPage />
          </Suspense>
        ),
      },
      {
        path: 'reports',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ReportsPage />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      {
        path: 'sync',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SyncMonitorPage />
          </Suspense>
        ),
      },
      {
        path: 'shift-end',
        element: (
          <Suspense fallback={<PageLoader />}>
            <ShiftEndPage />
          </Suspense>
        ),
      },
      {
        path: 'day-close',
        element: (
          <Suspense fallback={<PageLoader />}>
            <DayClosePage />
          </Suspense>
        ),
      },
      {
        path: 'terminal/:terminalId/shift',
        element: (
          <Suspense fallback={<PageLoader />}>
            <TerminalShiftPage />
          </Suspense>
        ),
      },
    ],
  },
]);

// ============================================================================
// Router Provider
// ============================================================================

export function AppRouter() {
  return <RouterProvider router={router} />;
}

export { router };
