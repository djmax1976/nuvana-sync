/**
 * NUVANA DESIGN SYSTEM - Design Tokens Reference
 *
 * This file provides TypeScript constants and documentation for the design system.
 * Use these tokens to ensure consistency across the application.
 *
 * The actual CSS variables are defined in globals.css and consumed via Tailwind.
 * This file serves as a reference and for programmatic access to token values.
 *
 * @example
 * // In a component:
 * import { colors, spacing } from '@/styles/design-tokens';
 *
 * // Use Tailwind classes (preferred):
 * <div className="bg-primary text-primary-foreground">
 *
 * // Or access values programmatically (for charts, etc.):
 * const chartColor = colors.chart[1];
 *
 * @module renderer/styles/design-tokens
 */

// =============================================================================
// COLOR TOKENS
// =============================================================================

/**
 * Semantic color tokens for consistent UI
 *
 * @usage Tailwind: bg-{color}, text-{color}, border-{color}
 * @example bg-primary, text-success, border-warning
 */
export const colors = {
  // Brand Colors
  primary: {
    DEFAULT: 'hsl(217, 91%, 60%)', // #3B82F6 - Primary blue
    hover: 'hsl(217, 91%, 55%)', // Darker on hover
    foreground: 'hsl(0, 0%, 100%)', // White text
    light: 'hsl(214, 95%, 93%)', // #DBEAFE - Light tint
    muted: 'hsl(214, 32%, 91%)', // Subtle background
  },

  // Status Colors
  success: {
    DEFAULT: 'hsl(142, 71%, 45%)', // #22C55E - Green
    foreground: 'hsl(0, 0%, 100%)',
    light: 'hsl(138, 76%, 94%)', // #DCFCE7
    muted: 'hsl(142, 76%, 36%)', // Darker for text
  },
  warning: {
    DEFAULT: 'hsl(38, 92%, 50%)', // #F59E0B - Amber
    foreground: 'hsl(0, 0%, 100%)',
    light: 'hsl(48, 96%, 89%)', // #FEF3C7
    muted: 'hsl(38, 92%, 40%)',
  },
  destructive: {
    DEFAULT: 'hsl(0, 84%, 60%)', // #EF4444 - Red
    foreground: 'hsl(0, 0%, 100%)',
    light: 'hsl(0, 86%, 94%)', // #FEE2E2
    muted: 'hsl(0, 84%, 40%)',
  },
  info: {
    DEFAULT: 'hsl(199, 89%, 48%)', // #0EA5E9 - Sky
    foreground: 'hsl(0, 0%, 100%)',
    light: 'hsl(201, 94%, 94%)', // #E0F2FE
    muted: 'hsl(199, 89%, 38%)',
  },

  // Neutral Colors
  background: 'hsl(220, 14%, 96%)', // #F1F5F9 - Page background
  foreground: 'hsl(222, 47%, 11%)', // #1E293B - Primary text
  muted: {
    DEFAULT: 'hsl(210, 40%, 96%)',
    foreground: 'hsl(215, 16%, 47%)', // #64748B - Secondary text
  },
  card: {
    DEFAULT: 'hsl(0, 0%, 100%)', // White
    foreground: 'hsl(222, 47%, 11%)',
    hover: 'hsl(210, 20%, 98%)',
  },
  border: 'hsl(214, 32%, 91%)', // #E2E8F0

  // Chart Colors (for data visualization)
  chart: {
    1: 'hsl(217, 91%, 60%)', // Primary blue
    2: 'hsl(142, 71%, 45%)', // Green
    3: 'hsl(38, 92%, 50%)', // Amber
    4: 'hsl(262, 83%, 58%)', // Purple
    5: 'hsl(199, 89%, 48%)', // Sky
    6: 'hsl(0, 84%, 60%)', // Red
  },
} as const;

// =============================================================================
// TYPOGRAPHY TOKENS
// =============================================================================

/**
 * Typography scale for consistent text hierarchy
 *
 * @usage Tailwind: text-{size}
 * @example text-stat-value, text-card-title, text-body
 */
export const typography = {
  // Stat/Metric display
  statValue: {
    size: '2rem', // 32px
    lineHeight: '1.2',
    fontWeight: '700',
  },
  statValueSm: {
    size: '1.5rem', // 24px
    lineHeight: '1.2',
    fontWeight: '700',
  },

  // Headings
  headingXl: {
    size: '2rem', // 32px
    lineHeight: '1.25',
    fontWeight: '700',
    letterSpacing: '-0.01em',
  },
  headingLg: {
    size: '1.5rem', // 24px
    lineHeight: '1.3',
    fontWeight: '600',
  },
  heading: {
    size: '1.25rem', // 20px
    lineHeight: '1.4',
    fontWeight: '600',
  },
  headingSm: {
    size: '1.125rem', // 18px
    lineHeight: '1.4',
    fontWeight: '600',
  },

  // Body text
  bodyLg: {
    size: '1rem', // 16px
    lineHeight: '1.6',
  },
  body: {
    size: '0.875rem', // 14px
    lineHeight: '1.5',
  },
  bodySm: {
    size: '0.8125rem', // 13px
    lineHeight: '1.5',
  },

  // Captions/Labels
  caption: {
    size: '0.75rem', // 12px
    lineHeight: '1.4',
  },
  captionSm: {
    size: '0.6875rem', // 11px
    lineHeight: '1.3',
  },
} as const;

// =============================================================================
// SPACING TOKENS
// =============================================================================

/**
 * Spacing scale for consistent layouts
 *
 * @usage Tailwind: p-{token}, m-{token}, gap-{token}
 * @example p-card-padding, gap-dashboard-gap
 */
export const spacing = {
  // Page layout
  page: '1.5rem', // 24px
  pageSm: '1rem', // 16px
  section: '2rem', // 32px

  // Card spacing
  cardPadding: '1rem', // 16px
  cardPaddingLg: '1.5rem', // 24px

  // Dashboard grid
  dashboardGap: '1rem', // 16px
  dashboardGapLg: '1.5rem', // 24px

  // Table cells
  tableCellX: {
    default: '1rem', // 16px
    compact: '0.75rem', // 12px
    dense: '0.5rem', // 8px
  },
  tableCellY: {
    default: '0.75rem', // 12px
    compact: '0.5rem', // 8px
    dense: '0.375rem', // 6px
  },
} as const;

// =============================================================================
// BORDER RADIUS TOKENS
// =============================================================================

/**
 * Border radius scale for consistent rounding
 *
 * @usage Tailwind: rounded-{size}
 * @example rounded-lg, rounded-xl
 */
export const borderRadius = {
  sm: '0.375rem', // 6px - Small elements
  md: '0.5rem', // 8px - Default
  lg: '0.75rem', // 12px - Cards
  xl: '1rem', // 16px - Large cards
  '2xl': '1.5rem', // 24px - Extra large
  full: '9999px', // Pill shapes
} as const;

// =============================================================================
// SHADOW TOKENS
// =============================================================================

/**
 * Shadow scale for elevation
 *
 * @usage Tailwind: shadow-{size}
 * @example shadow-card, shadow-card-hover
 */
export const shadows = {
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  card: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px 0 rgb(0 0 0 / 0.02)',
  cardHover: '0 4px 12px 0 rgb(0 0 0 / 0.08)',
} as const;

// =============================================================================
// ANIMATION TOKENS
// =============================================================================

/**
 * Animation timing tokens
 *
 * @usage Tailwind: duration-{speed}, animate-{name}
 * @example duration-fast, animate-fade-in
 */
export const animation = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },
  easing: {
    default: 'ease-out',
    smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const;

// =============================================================================
// BREAKPOINT TOKENS
// =============================================================================

/**
 * Responsive breakpoints
 *
 * @usage Tailwind: sm:, md:, lg:, xl:, 2xl:
 */
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// =============================================================================
// COMPONENT STYLE PRESETS
// =============================================================================

/**
 * Pre-defined component style combinations
 * Use these as references for consistent component styling
 */
export const componentStyles = {
  /**
   * Card styling preset
   * @usage className="bg-card rounded-lg border shadow-card p-card-padding"
   */
  card: 'bg-card rounded-lg border border-border shadow-card',

  /**
   * Interactive card with hover effect
   * @usage className={componentStyles.cardInteractive}
   */
  cardInteractive:
    'bg-card rounded-lg border border-border shadow-card transition-shadow duration-normal hover:shadow-card-hover',

  /**
   * Stat card for dashboard metrics
   * @usage className={componentStyles.statCard}
   */
  statCard: 'bg-card rounded-xl border border-border p-card-padding-lg shadow-card',

  /**
   * Page container
   * @usage className={componentStyles.pageContainer}
   */
  pageContainer: 'p-page space-y-section',

  /**
   * Dashboard grid layout
   * @usage className={componentStyles.dashboardGrid}
   */
  dashboardGrid: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-dashboard-gap',

  /**
   * Section header
   * @usage className={componentStyles.sectionHeader}
   */
  sectionHeader: 'text-heading font-semibold text-foreground',

  /**
   * Stat value display
   * @usage className={componentStyles.statValue}
   */
  statValue: 'text-stat-value font-bold text-foreground',

  /**
   * Muted label text
   * @usage className={componentStyles.label}
   */
  label: 'text-caption font-medium text-muted-foreground',
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ColorToken = keyof typeof colors;
export type TypographyToken = keyof typeof typography;
export type SpacingToken = keyof typeof spacing;
export type BorderRadiusToken = keyof typeof borderRadius;
export type ShadowToken = keyof typeof shadows;
export type BreakpointToken = keyof typeof breakpoints;
