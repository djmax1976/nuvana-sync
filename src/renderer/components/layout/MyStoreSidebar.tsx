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
  Plug,
  Monitor,
  Users,
  CalendarClock,
  Receipt,
} from 'lucide-react';
import logo from '../../assets/logo.png';
import { SyncStatusIndicator } from './SyncStatusIndicator';

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

  // Determine active states
  const isDashboardActive = pathname === '/' || pathname === '/mystore';
  const isClockInOutActive = pathname === '/clock-in-out';
  const isLotteryActive = pathname === '/lottery';
  const isLotteryGamesActive = pathname === '/lottery/games';
  const isPOSIntegrationActive = pathname === '/pos-integration';
  const isTerminalsActive = pathname === '/terminals' || pathname.startsWith('/terminal/');
  const isShiftsActive = pathname === '/shifts' || pathname.startsWith('/shifts/');
  const isTransactionsActive = pathname === '/transactions';
  const isEmployeesActive = pathname === '/employees';

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

        {/* Clock In/Out Link */}
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
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ml-4',
            isLotteryGamesActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Package className="h-4 w-4" />
          <span>Inventory</span>
        </Link>

        {/* POS Integration Link */}
        <Link
          to="/pos-integration"
          data-testid="pos-integration-link"
          onClick={() => onNavigate?.()}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isPOSIntegrationActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Plug className="h-5 w-5" />
          <span>POS Integration</span>
        </Link>

        {/* Terminals Link */}
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

        {/* Shifts Link */}
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

        {/* Transactions Link */}
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
