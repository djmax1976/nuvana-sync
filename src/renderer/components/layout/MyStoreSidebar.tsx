/**
 * MyStore Terminal Dashboard Sidebar Component
 *
 * Main navigation sidebar for the Electron desktop application.
 * Includes navigation links and sync status indicator in footer.
 *
 * @module renderer/components/layout/MyStoreSidebar
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data exposed in DOM
 */

import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  LayoutDashboard,
  Clock,
  Ticket,
  Package,
  Monitor,
  Users,
  CalendarClock,
  Receipt,
  BarChart3,
  CalendarCheck,
} from 'lucide-react';
import logo from '../../assets/logo.png';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useIsLotteryMode } from '../../hooks/usePOSConnectionType';

interface MyStoreSidebarProps {
  className?: string;
  onNavigate?: () => void;
}

/**
 * MyStore Terminal Dashboard Sidebar component for Electron
 * Shows navigation links for the desktop application
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-005: No sensitive data exposed in DOM
 *
 * Accessibility (WCAG 2.1 AA):
 * - Semantic nav element with aria-label
 * - Proper link focus states
 * - Keyboard navigable
 */
export function MyStoreSidebar({ className, onNavigate }: MyStoreSidebarProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const isLotteryMode = useIsLotteryMode();

  // Determine active states
  const isDashboardActive = pathname === '/' || pathname === '/mystore';
  const isClockInOutActive = pathname === '/clock-in-out';
  const isLotteryActive = pathname === '/lottery';
  const isLotteryGamesActive = pathname === '/lottery/games';
  const isTerminalsActive = pathname === '/terminals' || pathname.startsWith('/terminal/');
  const isShiftsActive = pathname === '/shifts' || pathname.startsWith('/shifts/');
  const isReportsActive = pathname === '/reports';
  const isTransactionsActive = pathname === '/transactions';
  const isEmployeesActive = pathname === '/employees';
  const isDayCloseActive = pathname === '/day-close';

  return (
    <div
      className={cn('flex h-full w-64 flex-col border-r bg-background', className)}
      data-testid="mystore-sidebar"
    >
      <div className="flex h-16 items-center border-b px-6 gap-3">
        <img src={logo} alt="Nuvana Logo" className="h-9 w-9 rounded-lg object-contain" />
        <h2 className="text-lg font-bold text-foreground">NUVANA</h2>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {/* Dashboard Link */}
        <Link
          to="/"
          data-testid="dashboard-link"
          onClick={() => onNavigate?.()}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isDashboardActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <LayoutDashboard className="h-5 w-5" />
          <span>Dashboard</span>
        </Link>

        {/* Clock In/Out Link - Hidden in lottery mode (SC-NAV-002) */}
        {!isLotteryMode && (
          <Link
            to="/clock-in-out"
            data-testid="clock-in-out-link"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isClockInOutActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Clock className="h-5 w-5" />
            <span>Clock In/Out</span>
          </Link>
        )}

        {/* Lottery Management Link */}
        <Link
          to="/lottery"
          data-testid="lottery-link"
          onClick={() => onNavigate?.()}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isLotteryActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Ticket className="h-5 w-5" />
          <span>Lottery</span>
        </Link>

        {/* Lottery Inventory Link */}
        <Link
          to="/lottery/games"
          data-testid="lottery-games-link"
          onClick={() => onNavigate?.()}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isLotteryGamesActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Package className="h-5 w-5" />
          <span>Lottery Inventory</span>
        </Link>

        {/* Terminals Link - Hidden in lottery mode (SC-NAV-002) */}
        {!isLotteryMode && (
          <Link
            to="/terminals"
            data-testid="terminals-link"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isTerminalsActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Monitor className="h-5 w-5" />
            <span>Terminals</span>
          </Link>
        )}

        {/* Shifts Link - Hidden in lottery mode (SC-NAV-002) */}
        {!isLotteryMode && (
          <Link
            to="/shifts"
            data-testid="shifts-link"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isShiftsActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <CalendarClock className="h-5 w-5" />
            <span>Shifts</span>
          </Link>
        )}

        {/* Day Close Link - Only for MANUAL_ENTRY stores (SC-NAV-003) */}
        {!isLotteryMode && (
          <Link
            to="/day-close"
            data-testid="day-close-link"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isDayCloseActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <CalendarCheck className="h-5 w-5" />
            <span>Day Close</span>
          </Link>
        )}

        {/* Reports Link */}
        <Link
          to="/reports"
          data-testid="reports-link"
          onClick={() => onNavigate?.()}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isReportsActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <BarChart3 className="h-5 w-5" />
          <span>Reports</span>
        </Link>

        {/* Transactions Link - Hidden in lottery mode (SC-NAV-002) */}
        {!isLotteryMode && (
          <Link
            to="/transactions"
            data-testid="transactions-link"
            onClick={() => onNavigate?.()}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isTransactionsActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Receipt className="h-5 w-5" />
            <span>Transactions</span>
          </Link>
        )}

        {/* Employees Link */}
        <Link
          to="/employees"
          data-testid="employees-link"
          onClick={() => onNavigate?.()}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isEmployeesActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Users className="h-5 w-5" />
          <span>Employees</span>
        </Link>
      </nav>

      {/* Footer with sync status indicator */}
      <div className="border-t px-4 py-3" data-testid="sidebar-footer" aria-label="Sync status">
        <SyncStatusIndicator showTooltip={true} compact={false} />
      </div>
    </div>
  );
}
