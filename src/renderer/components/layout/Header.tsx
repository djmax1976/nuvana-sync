import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { CurrentDateTime } from './CurrentDateTime';

/**
 * Header component props
 */
export interface HeaderProps {
  /**
   * Variant controls the header layout:
   * - "full": Full header with controls (default, for desktop)
   * - "controls-only": Only renders the right-side controls (for mobile embedded use)
   */
  variant?: 'full' | 'controls-only';
}

/**
 * Settings button component - navigates directly to settings page
 * Defined outside Header to avoid re-creation during render cycles
 */
function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} data-testid="settings-button">
      <Settings className="h-5 w-5" />
      <span className="sr-only">Settings</span>
    </Button>
  );
}

/**
 * Header Component for Electron Desktop App
 *
 * Displays the main header for the dashboard with:
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
  const navigate = useNavigate();

  const handleSettingsClick = () => navigate('/settings');

  // Controls-only variant: render just the right-side controls for mobile embedding
  if (variant === 'controls-only') {
    return (
      <div className="flex flex-col items-end justify-center">
        {/* Controls row - settings, dark mode toggle (no datetime on mobile) */}
        <div className="flex items-center gap-1">
          <SettingsButton onClick={handleSettingsClick} />
          <ThemeToggle />
        </div>
      </div>
    );
  }

  // Full variant: render complete header with controls
  return (
    <header
      className="flex h-16 items-center justify-end border-b bg-background px-4 sm:px-6"
      data-testid="header"
    >
      {/* Right - Controls */}
      <div className="flex items-center gap-2">
        <CurrentDateTime />
        <SettingsButton onClick={handleSettingsClick} />
        <ThemeToggle />
      </div>
    </header>
  );
}
