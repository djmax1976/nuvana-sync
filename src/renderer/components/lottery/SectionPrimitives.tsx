/**
 * Shared UI Primitives for Lottery Section Components
 *
 * Provides consistent visual elements used across collapsible pack sections
 * (Returned, Depleted, Activated) on the lottery page.
 *
 * @module renderer/components/lottery/SectionPrimitives
 * @security FE-001: XSS prevention via React JSX auto-escaping
 * @security SEC-004: No dangerouslySetInnerHTML, all output escaped
 * @security SEC-014: Type-safe props with TypeScript interfaces
 */

import { ChevronRight } from 'lucide-react';

// ============================================================================
// TYPE DEFINITIONS
// SEC-014: Strict type definitions for component props
// ============================================================================

/** Color themes for section icons — constrained allowlist */
type SectionColorTheme = 'orange' | 'violet' | 'blue';

// ============================================================================
// CONSTANTS
// SEC-004: Only safe CSS class names in constrained lookup table
// ============================================================================

/**
 * Theme classes for section icons
 * SEC-004: Constrained lookup table — no user input interpolation
 */
const ICON_THEME_CLASSES: Readonly<Record<SectionColorTheme, string>> = {
  orange: 'bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400',
  violet: 'bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400',
  blue: 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400',
};

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Colored icon container for section headers.
 * Renders a 40x40 rounded square with a theme-colored background and icon.
 *
 * SEC-004: Only safe CSS class names from constrained lookup
 * FE-001: React JSX auto-escaping for all output
 */
export function SectionIcon({
  colorTheme,
  children,
}: {
  colorTheme: SectionColorTheme;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 ${ICON_THEME_CLASSES[colorTheme]}`}
    >
      {children}
    </span>
  );
}

/**
 * Bin number badge — blue rounded square displaying a numeric bin identifier.
 *
 * SEC-004: Only numeric value rendered via JSX auto-escaping
 * SEC-014: Input constrained to number type
 */
export function BinBadge({ number }: { number: number }) {
  return (
    <span className="rounded-lg sm:rounded-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold text-[13px] sm:text-[15px] flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 min-w-[32px] sm:min-w-[40px]">
      {number}
    </span>
  );
}

/**
 * Collapsible section header for pack sections.
 * Renders a full-width button with icon + title on left, badge + chevron on right.
 *
 * SEC-004: All values rendered via JSX auto-escaping
 * FE-001: No dangerouslySetInnerHTML
 * SEC-014: Strict props interface
 */
export function PackSectionHeader({
  icon,
  title,
  count,
  isOpen,
  onToggle,
  rightBadge,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  rightBadge?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      className="flex items-center justify-between w-full bg-card hover:bg-muted/50 px-4 py-4 text-sm font-semibold text-foreground transition-colors border-b border-border"
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex flex-col items-start">
          <span className="font-semibold">
            {title} ({count})
          </span>
          {subtitle && (
            <span className="text-xs font-normal text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {rightBadge}
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform duration-[350ms] ease-out ${isOpen ? 'rotate-90' : ''}`}
        />
      </div>
    </button>
  );
}
