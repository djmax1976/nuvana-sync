import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Integration tests require native modules (better-sqlite3)
      // Run separately with actual database via `npm run test:integration`
      'tests/integration/**',
    ],
    passWithNoTests: false,
    // Use forks pool with isolation (Vitest 4 compatible)
    pool: 'forks',
    isolate: true,
    // Add server.deps.inline to help with ESM module resolution for vi.mock
    server: {
      deps: {
        inline: [/^(?!.*vitest).*$/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/renderer/**', // React components - tested separately
        'src/preload/**', // Electron preload scripts
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
