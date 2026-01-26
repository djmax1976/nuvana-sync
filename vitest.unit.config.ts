/**
 * Vitest Configuration for Pure Unit Tests
 *
 * This configuration is for pure unit tests that:
 * - Test pure functions (parsers, validators, formatters)
 * - Test utility functions
 * - Test React hooks (with jsdom)
 * - Do NOT require a database
 * - Do NOT require native modules
 *
 * Run with: npm run test:unit:pure
 *
 * For integration tests with real database, use vitest.integration.config.ts
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      // Pure unit tests (parsers, validators, formatters)
      'tests/unit/utils/**/*.spec.ts',
      'tests/unit/parsers/**/*.spec.ts',
      'tests/unit/validators/**/*.spec.ts',
      'tests/unit/formatters/**/*.spec.ts',
      // Component tests can be included if using jsdom environment
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude service tests that need mocking/database
      'tests/unit/services/**',
      // Exclude DAL tests (need database)
      'tests/unit/dal/**',
      // Exclude IPC tests (need Electron mocks)
      'tests/unit/ipc/**',
      // Exclude integration tests
      'tests/integration/**',
    ],
    passWithNoTests: true, // Allow running even if no tests match
    pool: 'forks',
    isolate: true,
    // Server deps for ESM module resolution
    server: {
      deps: {
        inline: [/^(?!.*vitest).*$/],
      },
    },
    // No coverage thresholds for pure unit tests
    // Coverage is measured on the full test suite
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
