/**
 * Design Tokens - Enterprise Design System
 *
 * This file provides TypeScript constants for design tokens that need to be used
 * programmatically in components (e.g., charts, dynamic styles).
 *
 * For CSS-based styling, use Tailwind classes which reference CSS custom properties.
 * Use these constants only when you need values in JavaScript/TypeScript.
 */

/* ============================================================================
   COLOR TOKENS
   Use these when you need colors in JavaScript (e.g., charts, canvas, etc.)
   ============================================================================ */

/**
 * Primary brand colors
 */
export const COLORS = {
  // Primary Blue
  primary: {
    DEFAULT: '#3B82F6', // blue-500
    light: '#DBEAFE', // blue-100
    dark: '#1D4ED8', // blue-700
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
  },

  // Semantic Status Colors
  success: {
    DEFAULT: '#22C55E', // green-500
    light: '#DCFCE7', // green-100
    dark: '#16A34A', // green-600
    muted: '#15803D', // green-700 (for text on light bg)
  },

  warning: {
    DEFAULT: '#F59E0B', // amber-500
    light: '#FEF3C7', // amber-100
    dark: '#D97706', // amber-600
    muted: '#B45309', // amber-700 (for text on light bg)
  },

  destructive: {
    DEFAULT: '#EF4444', // red-500
    light: '#FEE2E2', // red-100
    dark: '#DC2626', // red-600
    muted: '#B91C1C', // red-700 (for text on light bg)
  },

  info: {
    DEFAULT: '#0EA5E9', // sky-500
    light: '#E0F2FE', // sky-100
    dark: '#0284C7', // sky-600
    muted: '#0369A1', // sky-700 (for text on light bg)
  },

  // Neutral/Grey Scale
  neutral: {
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    300: '#CBD5E1',
    400: '#94A3B8',
    500: '#64748B',
    600: '#475569',
    700: '#334155',
    800: '#1E293B',
    900: '#0F172A',
  },
} as const;

/**
 * Chart color palette - Use for data visualization
 * Ordered for optimal visual distinction
 */
export const CHART_COLORS = {
  palette: [
    '#3B82F6', // Primary blue
    '#22C55E', // Green
    '#F59E0B', // Amber
    '#8B5CF6', // Purple
    '#0EA5E9', // Sky
    '#EF4444', // Red
    '#EC4899', // Pink
    '#14B8A6', // Teal
    '#F97316', // Orange
    '#6366F1', // Indigo
  ],

  // Semantic chart colors
  positive: '#22C55E',
  negative: '#EF4444',
  neutral: '#64748B',
  highlight: '#3B82F6',

  // Gradient pairs for area charts
  gradients: {
    blue: { start: '#3B82F6', end: '#DBEAFE' },
    green: { start: '#22C55E', end: '#DCFCE7' },
    amber: { start: '#F59E0B', end: '#FEF3C7' },
    purple: { start: '#8B5CF6', end: '#EDE9FE' },
  },
} as const;

/* ============================================================================
   ICON VARIANT STYLES
   Use with stat cards and icons to maintain visual consistency
   ============================================================================ */

export type IconVariant = 'primary' | 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

/**
 * Icon container styles by variant
 * Use with cn() helper: cn('w-10 h-10 rounded-lg flex items-center justify-center', ICON_STYLES[variant])
 */
export const ICON_STYLES: Record<IconVariant, string> = {
  primary: 'bg-primary-light text-primary',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  destructive: 'bg-destructive-light text-destructive',
  info: 'bg-info-light text-info',
  neutral: 'bg-muted text-muted-foreground',
};

/**
 * Icon background colors for programmatic use
 */
export const ICON_BG_COLORS: Record<IconVariant, string> = {
  primary: COLORS.primary.light,
  success: COLORS.success.light,
  warning: COLORS.warning.light,
  destructive: COLORS.destructive.light,
  info: COLORS.info.light,
  neutral: COLORS.neutral[100],
};

/**
 * Icon foreground colors for programmatic use
 */
export const ICON_FG_COLORS: Record<IconVariant, string> = {
  primary: COLORS.primary.DEFAULT,
  success: COLORS.success.DEFAULT,
  warning: COLORS.warning.DEFAULT,
  destructive: COLORS.destructive.DEFAULT,
  info: COLORS.info.DEFAULT,
  neutral: COLORS.neutral[500],
};

/* ============================================================================
   SPACING TOKENS
   ============================================================================ */

export const SPACING = {
  // Dashboard layout
  dashboardGap: '1rem', // 16px
  dashboardGapLg: '1.5rem', // 24px

  // Card padding
  cardPadding: '1rem', // 16px
  cardPaddingLg: '1.5rem', // 24px

  // Table cell padding
  tableCellX: '1rem', // 16px
  tableCellY: '0.75rem', // 12px
  tableCellXCompact: '0.75rem',
  tableCellYCompact: '0.5rem',
} as const;

/* ============================================================================
   BORDER RADIUS TOKENS
   ============================================================================ */

export const RADIUS = {
  sm: '0.375rem', // 6px
  DEFAULT: '0.5rem', // 8px
  lg: '0.75rem', // 12px
  xl: '1rem', // 16px
  full: '9999px',
} as const;

/* ============================================================================
   SHADOW TOKENS
   ============================================================================ */

export const SHADOWS = {
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  card: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px 0 rgb(0 0 0 / 0.02)',
  cardHover: '0 4px 12px 0 rgb(0 0 0 / 0.08)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
} as const;

/* ============================================================================
   TYPOGRAPHY TOKENS
   ============================================================================ */

export const TYPOGRAPHY = {
  fontFamily: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },

  fontSize: {
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px
    base: '1rem', // 16px
    lg: '1.125rem', // 18px
    xl: '1.25rem', // 20px
    '2xl': '1.5rem', // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem', // 36px
  },

  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  lineHeight: {
    tight: '1.25',
    snug: '1.375',
    normal: '1.5',
    relaxed: '1.625',
  },
} as const;

/* ============================================================================
   ANIMATION TOKENS
   ============================================================================ */

export const ANIMATION = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },

  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

/* ============================================================================
   BREAKPOINTS
   Match Tailwind's default breakpoints
   ============================================================================ */

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

/* ============================================================================
   Z-INDEX SCALE
   Consistent layering system
   ============================================================================ */

export const Z_INDEX = {
  dropdown: 50,
  sticky: 100,
  fixed: 150,
  modalBackdrop: 200,
  modal: 250,
  popover: 300,
  tooltip: 400,
  toast: 500,
} as const;

/* ============================================================================
   STATUS BADGE VARIANTS
   Reusable badge configurations
   ============================================================================ */

export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

export const BADGE_STYLES: Record<BadgeVariant, string> = {
  success: 'bg-success-light text-success-muted',
  warning: 'bg-warning-light text-warning-muted',
  destructive: 'bg-destructive-light text-destructive-muted',
  info: 'bg-info-light text-info-muted',
  neutral: 'bg-muted text-muted-foreground',
};

/* ============================================================================
   CHART CONFIGURATION HELPERS
   ============================================================================ */

/**
 * Get recharts-compatible color configuration
 */
export function getChartColor(index: number): string {
  return CHART_COLORS.palette[index % CHART_COLORS.palette.length];
}

/**
 * Create gradient definition for recharts
 */
export function createChartGradient(id: string, color: keyof typeof CHART_COLORS.gradients) {
  const gradient = CHART_COLORS.gradients[color];
  return {
    id,
    startColor: gradient.start,
    endColor: gradient.end,
  };
}

/* ============================================================================
   UTILITY TYPE EXPORTS
   ============================================================================ */

export type ColorKey = keyof typeof COLORS;
export type ChartColorIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
