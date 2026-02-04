/**
 * Renderer Test Setup
 *
 * Configures the jsdom environment for React component testing with:
 * - @testing-library/jest-dom matchers (toBeVisible, toHaveAttribute, etc.)
 * - Mock for @/lib/utils cn() function
 * - Mock for lucide-react icons
 *
 * @module tests/setup-renderer
 * @see vitest.config.ts - references this file in setupFiles
 */

import '@testing-library/jest-dom/vitest';
