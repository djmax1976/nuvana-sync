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
import { DayCloseAccessGuard } from './components/guards/DayCloseAccessGuard';
import { useIsLotteryMode } from './hooks/usePOSConnectionType';

// ============================================================================
// Lazy-loaded Pages
// ============================================================================

// Core pages - MyStore dashboard as main dashboard
const MyStoreDashboard = lazy(() =>
  import('./pages/MyStoreDashboard').then((m) => ({ default: m.MyStoreDashboard }))
);
const ShiftsPage = lazy(() => import('./pages/ShiftsPage'));
// ShiftDetailPage removed - ViewShiftPage is now the universal shift view
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

// Placeholder pages for new routes
const ClockInOutPage = lazy(() => import('./pages/ClockInOutPage'));
const LotteryPage = lazy(() => import('./pages/LotteryPage'));
const LotteryGamesPage = lazy(() => import('./pages/LotteryGamesPage'));
const TerminalsPage = lazy(() => import('./pages/TerminalsPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));

// Wizard pages
const ShiftEndPage = lazy(() => import('./pages/ShiftEndPage'));
const DayClosePage = lazy(() => import('./pages/DayClosePage'));
const TerminalShiftPage = lazy(() => import('./pages/TerminalShiftPage'));

// Report pages
const LotteryDayReportPage = lazy(() => import('./pages/LotteryDayReportPage'));

// View pages (read-only views for closed shifts/days)
const ViewShiftPage = lazy(() => import('./pages/ViewShiftPage'));
const ViewDayPage = lazy(() => import('./pages/ViewDayPage'));

// Sync Monitor is now embedded in the Settings page (SyncMonitorPanel component)

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
// Route Guards
// ============================================================================

/**
 * LotteryGuard - Prevents access to non-lottery routes in lottery-only stores
 *
 * When a store's POS type is LOTTERY, this guard redirects to the dashboard.
 * During loading state (data undefined), children render normally to prevent flash.
 *
 * Security: SC-GUARD-002 - Redirects in lottery mode
 * UX: SC-GUARD-003 - No flash redirect during loading
 *
 * @param children - The route element to render if not in lottery mode
 */
function LotteryGuard({ children }: { children: React.ReactNode }) {
  const isLotteryMode = useIsLotteryMode();

  // In lottery mode, redirect to dashboard
  // During loading (isLotteryMode === false when data undefined), render children
  if (isLotteryMode) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
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
    element: <SetupWizard onComplete={() => (window.location.href = '#/lottery')} />,
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
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <ClockInOutPage />
            </Suspense>
          </LotteryGuard>
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
        path: 'terminals',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <TerminalsPage />
            </Suspense>
          </LotteryGuard>
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
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <ShiftsPage />
            </Suspense>
          </LotteryGuard>
        ),
      },
      {
        path: 'shifts/:shiftId',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <ViewShiftPage />
            </Suspense>
          </LotteryGuard>
        ),
      },
      {
        // Legacy route - redirect to canonical path
        path: 'shifts/:shiftId/view',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <ViewShiftPage />
            </Suspense>
          </LotteryGuard>
        ),
      },
      {
        path: 'days/:dayId/view',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <ViewDayPage />
            </Suspense>
          </LotteryGuard>
        ),
      },
      {
        path: 'transactions',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <TransactionsPage />
            </Suspense>
          </LotteryGuard>
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
        path: 'shift-end',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <ShiftEndPage />
            </Suspense>
          </LotteryGuard>
        ),
      },
      {
        path: 'day-close',
        element: (
          <LotteryGuard>
            <DayCloseAccessGuard>
              <Suspense fallback={<PageLoader />}>
                <DayClosePage />
              </Suspense>
            </DayCloseAccessGuard>
          </LotteryGuard>
        ),
      },
      {
        path: 'terminal/:terminalId/shift',
        element: (
          <LotteryGuard>
            <Suspense fallback={<PageLoader />}>
              <TerminalShiftPage />
            </Suspense>
          </LotteryGuard>
        ),
      },
      {
        path: 'lottery-day-report',
        element: (
          <Suspense fallback={<PageLoader />}>
            <LotteryDayReportPage />
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
