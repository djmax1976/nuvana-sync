/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/renderer/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      /* ========================================================================
         COLOR SYSTEM
         All colors use CSS custom properties for theming support
         ======================================================================== */
      colors: {
        // Base semantic colors
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        // Primary brand color (blue)
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          light: "hsl(var(--primary-light))",
          muted: "hsl(var(--primary-muted))",
        },

        // Secondary color
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },

        // Status colors with full range
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          light: "hsl(var(--destructive-light))",
          muted: "hsl(var(--destructive-muted))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          light: "hsl(var(--success-light))",
          muted: "hsl(var(--success-muted))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          light: "hsl(var(--warning-light))",
          muted: "hsl(var(--warning-muted))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          light: "hsl(var(--info-light))",
          muted: "hsl(var(--info-muted))",
        },

        // Muted elements
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },

        // Accent color
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          light: "hsl(var(--accent-light))",
        },

        // Popover/dropdown
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },

        // Card
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          hover: "hsl(var(--card-hover))",
        },

        // Sidebar
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-bg))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
          "item-hover": "hsl(var(--sidebar-item-hover))",
          "item-active": "hsl(var(--sidebar-item-active))",
          "item-active-text": "hsl(var(--sidebar-item-active-text))",
        },

        // Chart colors
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
        },
      },

      /* ========================================================================
         BORDER RADIUS
         Consistent rounded corners across the app
         ======================================================================== */
      borderRadius: {
        lg: "var(--radius-lg)",       // 12px - Cards, modals
        md: "var(--radius)",          // 8px - Default
        sm: "var(--radius-sm)",       // 6px - Small elements
        xl: "var(--radius-xl)",       // 16px - Large cards
        full: "var(--radius-full)",   // Pill shapes
      },

      /* ========================================================================
         BOX SHADOWS
         Consistent shadow system
         ======================================================================== */
      boxShadow: {
        "xs": "var(--shadow-xs)",
        "card": "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
      },

      /* ========================================================================
         SPACING - Table Design Tokens
         ======================================================================== */
      spacing: {
        // Table cell padding
        'table-cell-x-default': '1rem',      // 16px horizontal padding
        'table-cell-y-default': '0.75rem',   // 12px vertical padding
        'table-cell-x-compact': '0.75rem',   // 12px horizontal padding
        'table-cell-y-compact': '0.5rem',    // 8px vertical padding
        'table-cell-x-dense': '0.5rem',      // 8px horizontal padding
        'table-cell-y-dense': '0.375rem',    // 6px vertical padding
        // Dashboard spacing
        'dashboard-gap': '1rem',             // 16px gap between cards
        'dashboard-gap-lg': '1.5rem',        // 24px gap for larger screens
        'card-padding': '1rem',              // 16px card padding
        'card-padding-lg': '1.5rem',         // 24px card padding
      },

      /* ========================================================================
         HEIGHT - Table Headers
         ======================================================================== */
      height: {
        'table-header-default': '3rem',      // 48px header height
        'table-header-compact': '2.5rem',    // 40px header height
        'table-header-dense': '2rem',        // 32px header height
      },

      /* ========================================================================
         FONT SIZES
         Consistent typography scale
         ======================================================================== */
      fontSize: {
        // Data display sizes
        'stat-value': ['2rem', { lineHeight: '1.2', fontWeight: '700' }],         // 32px - Big numbers
        'stat-value-sm': ['1.5rem', { lineHeight: '1.2', fontWeight: '700' }],    // 24px - Medium numbers
        'card-title': ['0.875rem', { lineHeight: '1.4', fontWeight: '500' }],     // 14px - Card titles
        'card-subtitle': ['0.75rem', { lineHeight: '1.4', fontWeight: '400' }],   // 12px - Subtitles
        'data-label': ['0.6875rem', { lineHeight: '1.4', fontWeight: '500' }],    // 11px - Small labels
      },

      /* ========================================================================
         KEYFRAME ANIMATIONS
         ======================================================================== */
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-out-right": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(100%)" },
        },
        "scale-in": {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },

      /* ========================================================================
         ANIMATION UTILITIES
         ======================================================================== */
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "fade-out": "fade-out 0.2s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-out-right": "slide-out-right 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },

      /* ========================================================================
         TRANSITION DURATION
         ======================================================================== */
      transitionDuration: {
        "fast": "150ms",
        "normal": "200ms",
        "slow": "300ms",
      },
    },
  },
  plugins: [],
};
