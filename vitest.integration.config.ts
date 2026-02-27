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
      'tests/integration/**/*.spec.ts',
      'tests/integration/**/*.spec.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
      'tests/security/**/*.spec.ts',
      'tests/security/**/*.spec.tsx',
      'tests/security/**/*.test.ts',
      'tests/security/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Setup file for React Testing Library
    setupFiles: ['./tests/setup-renderer.ts'],
    passWithNoTests: false,
    // Use forks pool for native module compatibility (better-sqlite3)
    // Threads pool causes segfaults (exit code 139) when workers terminate with open DB connections
    // Note: vmForks has issues with ESM modules in react-router, but regular forks is fine
    pool: 'forks',
    isolate: true,
    // Longer timeout for integration tests
    testTimeout: 30000,
    // Required for native modules like better-sqlite3-multiple-ciphers
    // Also inline react-router for ESM/CJS compatibility in tests
    server: {
      deps: {
        inline: [
          /^(?!.*vitest).*$/,
          'better-sqlite3-multiple-ciphers',
          'react-router',
          'react-router-dom',
        ],
      },
    },
    deps: {
      interopDefault: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  // Don't bundle native modules
  optimizeDeps: {
    exclude: ['better-sqlite3-multiple-ciphers'],
  },
});
