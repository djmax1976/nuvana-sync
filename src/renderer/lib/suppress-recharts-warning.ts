/**
 * Recharts Console Warning Suppressor
 *
 * This module suppresses the known Recharts 3.x bug where ResponsiveContainer
 * incorrectly logs "width(-1) and height(-1)" warnings even when charts render correctly.
 *
 * See: https://github.com/recharts/recharts/issues/6716
 * - Reported: Dec 2, 2025
 * - Affects: Recharts 3.x (works correctly in 2.x)
 * - Status: Open bug, charts render fine despite warning
 *
 * This suppression can be removed once Recharts releases a fix.
 *
 * @module lib/suppress-recharts-warning
 */

/**
 * Pattern to match the Recharts ResponsiveContainer warning.
 * The warning includes dynamic values like width(-1) and height(-1).
 */
const RECHARTS_WARNING_PATTERN =
  /The width\(-?\d+\) and height\(-?\d+\) of chart should be greater than 0/;

/**
 * Store the original console.warn function
 */
const originalWarn = console.warn;

/**
 * Flag to track if suppression is active (prevents double-patching)
 */
let isPatched = false;

/**
 * Suppresses the known Recharts 3.x ResponsiveContainer warning.
 *
 * This patches console.warn to filter out the specific Recharts warning
 * while allowing all other warnings to pass through normally.
 *
 * @example
 * // Call once at app initialization (before React renders)
 * import '@/lib/suppress-recharts-warning';
 *
 * @security This only filters console output; no security implications.
 */
export function suppressRechartsWarning(): void {
  if (isPatched) {
    return; // Already patched, don't double-patch
  }

  console.warn = (...args: unknown[]): void => {
    // Check if the first argument is a string matching the Recharts warning
    if (typeof args[0] === 'string' && RECHARTS_WARNING_PATTERN.test(args[0])) {
      // Suppress this specific warning (known Recharts 3.x bug)
      return;
    }

    // Pass all other warnings through to the original console.warn
    originalWarn.apply(console, args);
  };

  isPatched = true;
}

/**
 * Restores the original console.warn function.
 * Useful for testing or if the Recharts bug is fixed.
 */
export function restoreConsoleWarn(): void {
  if (isPatched) {
    console.warn = originalWarn;
    isPatched = false;
  }
}

// Auto-execute on import for convenience
suppressRechartsWarning();
