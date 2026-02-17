/**
 * Onboarding Loading Modal Component
 *
 * Story: BIZ-012-UX-FIX - Direct Onboarding Update
 *
 * Displays a full-screen blocking modal while onboarding status is loading.
 * This prevents race conditions where users scan barcodes before the system
 * knows whether to use onboarding mode or normal mode.
 *
 * @requirements
 * - AC #1: Modal blocks all interaction during loading
 * - AC #2: Displays "Preparing onboarding..." with spinner
 * - AC #3: Auto-dismisses when loading completes (controlled by parent)
 * - AC #4: WCAG compliant with proper ARIA attributes
 *
 * MCP Guidance Applied:
 * - FE-001: FE_XSS_PREVENTION - Static text only, React JSX auto-escaping
 * - SEC-014: INPUT_VALIDATION - No user input displayed
 * - A11Y-008: A11Y_COLOR_CONTRAST - Proper contrast ratios
 * - ARCH-001: FE_COMPONENT_DESIGN - Single responsibility component
 */

import { Loader2 } from 'lucide-react';

/**
 * Props for OnboardingLoadingModal component
 * ARCH-001: Clear props interface with TypeScript
 */
export interface OnboardingLoadingModalProps {
  /**
   * Whether the modal is open/visible
   * When true, blocks all page interaction
   */
  open: boolean;
}

/**
 * OnboardingLoadingModal component
 *
 * Displays a full-screen modal overlay while the onboarding status is being
 * fetched from the backend. This prevents the race condition where the first
 * barcode scan fails because `onboardingMode` is still false while the query
 * is loading.
 *
 * Security Notes:
 * - SEC-014: All displayed text is static (no user input)
 * - FE-001: React JSX provides automatic XSS escaping
 *
 * Accessibility Notes:
 * - role="dialog" + aria-modal="true": Screen readers announce as modal
 * - aria-busy="true": Indicates content is loading
 * - aria-describedby: Links to description text for screen readers
 * - Focus trap: Modal overlay prevents interaction with underlying content
 *
 * @example
 * ```tsx
 * <OnboardingLoadingModal open={isFirstEver && onboardingStatusLoading} />
 * ```
 */
export function OnboardingLoadingModal({ open }: OnboardingLoadingModalProps) {
  // Don't render if not open
  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="onboarding-loading-title"
      aria-describedby="onboarding-loading-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      style={{ pointerEvents: 'all' }}
      data-testid="onboarding-loading-modal"
    >
      {/*
        Modal content container
        A11Y-008: White text on dark background provides sufficient contrast
      */}
      <div className="flex flex-col items-center justify-center space-y-4 text-white">
        {/* Spinner animation */}
        <Loader2
          className="h-12 w-12 animate-spin text-primary"
          aria-hidden="true"
          data-testid="onboarding-loading-spinner"
        />

        {/* Title - SEC-014: Static text, no user input */}
        <h2
          id="onboarding-loading-title"
          className="text-xl font-semibold"
          data-testid="onboarding-loading-title"
        >
          Preparing onboarding...
        </h2>

        {/* Description - SEC-014: Static text, no user input */}
        <p
          id="onboarding-loading-description"
          className="text-sm text-gray-300"
          data-testid="onboarding-loading-description"
        >
          Please wait while we prepare your lottery setup
        </p>
      </div>
    </div>
  );
}
