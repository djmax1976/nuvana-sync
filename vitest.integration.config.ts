import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.spec.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    pool: 'vmForks',
    isolate: true,
    // Longer timeout for integration tests
    testTimeout: 30000,
    // Required for native modules like better-sqlite3-multiple-ciphers
    server: {
      deps: {
        inline: [/^(?!.*vitest).*$/, 'better-sqlite3-multiple-ciphers'],
      },
    },
    deps: {
      interopDefault: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Don't bundle native modules
  optimizeDeps: {
    exclude: ['better-sqlite3-multiple-ciphers'],
  },
});
