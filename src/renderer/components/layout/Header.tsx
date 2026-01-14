import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui/button';
import { LogOut } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { CurrentDateTime } from './CurrentDateTime';

/**
 * Header component props
 */
export interface HeaderProps {
  /**
   * Variant controls the header layout:
   * - "full": Full header with page title centered (default, for desktop)
   * - "controls-only": Only renders the right-side controls (for mobile embedded use)
   */
  variant?: 'full' | 'controls-only';
}

// Page title mapping
const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/mystore': 'Dashboard',
  '/clock-in-out': 'Clock In/Out',
  '/lottery': 'Lottery',
  '/pos-integration': 'POS Integration',
  '/terminals': 'Terminals',
  '/settings': 'Settings',
};

/**
 * Header Component for Electron Desktop App
 *
 * Displays the main header for the dashboard with:
 * - Centered page title - only in "full" variant
 * - Current date/time display
 * - Dark mode toggle
 *
 * Security Considerations (FE-005: UI_SECURITY):
 * - No sensitive data exposed in DOM
 *
 * Security Considerations (SEC-004: XSS):
 * - All text content uses React's automatic escaping
 * - No dangerouslySetInnerHTML usage
 */
export function Header({ variant = 'full' }: HeaderProps) {
  const location = useLocation();

  // Get page title from pathname
  const getPageTitle = () => {
    if (location.pathname.startsWith('/terminal/')) {
      return 'Terminal Details';
    }
    return pageTitles[location.pathname] || 'Nuvana';
  };

  // Controls-only variant: render just the right-side controls for mobile embedding
  if (variant === 'controls-only') {
    return (
      <div className="flex flex-col items-end justify-center">
        {/* Controls row - dark mode toggle (no datetime on mobile) */}
        <div className="flex items-center gap-1">
          <ThemeToggle />
        </div>
      </div>
    );
  }

  // Full variant: render complete header with page title
  return (
    <header
      className="flex h-16 items-center justify-between border-b bg-background px-4 sm:px-6"
      data-testid="header"
    >
      {/* Left spacer for layout balance */}
      <div className="flex-1" />

      {/* Center - Page Title */}
      <div className="flex-1 flex justify-center">
        <h1
          className="text-lg font-semibold text-foreground truncate max-w-xs sm:max-w-md"
          data-testid="header-page-title"
        >
          {getPageTitle()}
        </h1>
      </div>

      {/* Right - Controls */}
      <div className="flex-1 flex justify-end">
        <div className="flex flex-col items-end justify-center">
          {/* Store name placeholder - can be connected to IPC later */}
          <span className="text-sm font-semibold text-foreground" data-testid="header-store-name">
            Local Store
          </span>
          {/* Controls row - date/time, dark mode */}
          <div className="flex items-center gap-2">
            <CurrentDateTime />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
