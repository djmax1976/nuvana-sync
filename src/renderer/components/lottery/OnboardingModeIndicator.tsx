/**
 * Onboarding Mode Indicator Component
 *
 * Story: Lottery Onboarding Feature (BIZ-010)
 *
 * Displays a visual indicator when onboarding mode is active for first-ever
 * lottery day initialization. In onboarding mode, scanned packs use their
 * current ticket position (serial_start from barcode) instead of defaulting to '000'.
 *
 * @requirements
 * - AC #1: Visual indicator shows "Onboarding Mode Active"
 * - AC #2: Display helpful instructions for the user
 * - AC #3: "Complete Onboarding" button to exit mode
 * - AC #4: Style with info/blue color (informational, not warning)
 *
 * MCP Guidance Applied:
 * - ARCH-001: FE_COMPONENT_DESIGN - Single responsibility, clear interface
 * - FE-001: FE_XSS_PREVENTION - Uses React JSX auto-escaping
 * - PERF-002: FE_RENDER_OPTIMIZATION - Simple pure component
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Info, CheckCircle2 } from 'lucide-react';

/**
 * Props for OnboardingModeIndicator component
 * ARCH-001: Clear props interface with TypeScript
 */
export interface OnboardingModeIndicatorProps {
  /**
   * Whether onboarding mode is active
   * When true, the indicator is visible
   */
  isActive: boolean;
  /**
   * Callback when user clicks "Complete Onboarding" button
   * SEC-010: Action triggers state change in parent component
   */
  onComplete: () => void;
  /**
   * Optional: Whether the complete button is disabled
   * Used during submission or other blocking operations
   */
  isCompleting?: boolean;
  /**
   * Optional: Count of packs activated during onboarding
   * BIZ-012-FIX: Displays progress to user
   */
  activatedPacksCount?: number;
}

/**
 * OnboardingModeIndicator component
 * Displays visual indicator when onboarding mode is active for first-ever lottery day
 *
 * BIZ-010: Onboarding mode allows new stores to set starting positions for
 * existing partially-sold packs during their first business day setup.
 *
 * @example
 * ```tsx
 * <OnboardingModeIndicator
 *   isActive={isOnboardingMode}
 *   onComplete={() => setIsOnboardingMode(false)}
 * />
 * ```
 */
export function OnboardingModeIndicator({
  isActive,
  onComplete,
  isCompleting = false,
  activatedPacksCount,
}: OnboardingModeIndicatorProps) {
  // Don't render if not active
  if (!isActive) {
    return null;
  }

  return (
    <Alert
      className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20"
      data-testid="onboarding-mode-indicator"
      role="status"
      aria-live="polite"
    >
      <Info className="h-4 w-4 text-blue-600 dark:text-blue-500" aria-hidden="true" />
      <AlertTitle className="text-blue-900 dark:text-blue-100">Onboarding Mode Active</AlertTitle>
      <AlertDescription className="mt-2 text-blue-800 dark:text-blue-200">
        <div className="space-y-3">
          <p className="text-sm">
            Welcome to lottery management! Scan your existing packs to record their current ticket
            positions. The system will use the scanned serial number as the starting position
            instead of defaulting to ticket #1.
          </p>
          {/* BIZ-012-FIX: Display activated packs count for user progress feedback */}
          {activatedPacksCount !== undefined && activatedPacksCount > 0 && (
            <p className="text-sm font-medium" data-testid="onboarding-pack-count">
              {activatedPacksCount} pack{activatedPacksCount === 1 ? '' : 's'} activated during
              onboarding
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onComplete}
              disabled={isCompleting}
              className="border-blue-300 bg-blue-100 hover:bg-blue-200 dark:border-blue-700 dark:bg-blue-900 dark:hover:bg-blue-800"
              data-testid="complete-onboarding-button"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {isCompleting ? 'Completing...' : 'Complete Onboarding'}
            </Button>
            <span className="text-xs text-blue-600 dark:text-blue-400">
              Click when all existing packs are scanned
            </span>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
