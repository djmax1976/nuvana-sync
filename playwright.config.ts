/**
 * Playwright E2E Test Configuration for Electron App
 *
 * Configuration for end-to-end testing of the Nuvana Sync Electron application.
 * Uses @playwright/test with electron-specific setup.
 *
 * @module playwright.config
 * @see https://playwright.dev/docs/api/class-electronapplication
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Determine if running in CI environment
const isCI = !!process.env.CI;

export default defineConfig({
  // Test directory
  testDir: './tests/e2e',

  // Test file pattern
  testMatch: '**/*.e2e.ts',

  // Timeout for each test
  timeout: 60000,

  // Timeout for expect assertions
  expect: {
    timeout: 10000,
  },

  // Fail fast in CI
  fullyParallel: !isCI,

  // Forbid test.only on CI
  forbidOnly: isCI,

  // Retry on CI only
  retries: isCI ? 2 : 0,

  // Limit parallel workers
  workers: isCI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
    isCI ? ['github'] : ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: isCI ? 'on-first-retry' : 'off',

    // Action timeout
    actionTimeout: 15000,
  },

  // Projects for different scenarios
  projects: [
    {
      name: 'electron',
      testDir: './tests/e2e',
      use: {
        // Electron-specific configuration handled in test fixtures
      },
    },
  ],

  // Global setup/teardown
  globalSetup: path.join(__dirname, 'tests/e2e/global-setup.ts'),
  globalTeardown: path.join(__dirname, 'tests/e2e/global-teardown.ts'),

  // Output directory for test artifacts
  outputDir: 'test-results/e2e',

  // Web server configuration (if needed for dev server)
  // webServer: {
  //   command: 'npm run dev',
  //   port: 5173,
  //   reuseExistingServer: !isCI,
  // },
});
