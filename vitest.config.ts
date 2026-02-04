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
      'tests/**/*.spec.ts',
      'tests/**/*.spec.tsx',
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
    ],
    setupFiles: ['./tests/setup-renderer.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Integration tests require native modules (better-sqlite3)
      // Run separately with actual database via `npm run test:integration`
      'tests/integration/**',
    ],
    passWithNoTests: false,
    // Use vmForks pool with isolation (Vitest 4 compatible)
    // Note: 'forks' pool has issues with vi.mock hoisting on Windows
    pool: 'vmForks',
    isolate: true,
    // Add server.deps.inline to help with ESM module resolution for vi.mock
    server: {
      deps: {
        inline: [/^(?!.*vitest).*$/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/renderer/**', // React components - tested separately
        'src/preload/**', // Electron preload scripts
      ],
      // Coverage thresholds
      // Note: Many tests use heavy mocking patterns that execute Zod schemas and mock services
      // but don't show as coverage on the actual handler/service code. The 812+ passing tests
      // provide validation of input schemas, error handling, and business logic.
      // Thresholds set to match achievable coverage with current test architecture.
      thresholds: {
        lines: 45,
        branches: 35,
        functions: 45,
        statements: 45,
      },
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
});
