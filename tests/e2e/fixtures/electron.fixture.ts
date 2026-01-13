/**
 * Electron Test Fixtures
 *
 * Provides Playwright fixtures for testing Electron applications.
 * Sets up and tears down ElectronApplication instances.
 *
 * @module tests/e2e/fixtures/electron
 */

import { test as base, type Page, type ElectronApplication, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Extended test fixtures for Electron testing
 */
export type ElectronTestFixtures = {
  /** The Electron application instance */
  electronApp: ElectronApplication;
  /** The main window page */
  window: Page;
  /** Path to test data directory */
  testDataDir: string;
  /** Clean up function for test isolation */
  cleanup: () => Promise<void>;
};

/**
 * Create a unique test database for isolation
 */
function createTestDatabasePath(testName: string): string {
  const testDataDir = process.env.NUVANA_TEST_DATA_DIR || path.join(process.cwd(), 'test-data', 'e2e');
  const sanitizedName = testName.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(testDataDir, `test_${sanitizedName}_${Date.now()}.db`);
}

/**
 * Electron test fixture configuration
 */
export const test = base.extend<ElectronTestFixtures>({
  electronApp: async ({}, use, testInfo) => {
    // Create isolated test database
    const dbPath = createTestDatabasePath(testInfo.title);

    // Launch Electron app
    const electronApp = await electron.launch({
      args: [
        path.join(process.cwd(), 'out/main/index.js'),
        '--test-mode',
        `--test-db-path=${dbPath}`,
      ],
      env: {
        ...process.env,
        NUVANA_TEST_MODE: 'true',
        NUVANA_TEST_DB_PATH: dbPath,
        NODE_ENV: 'test',
      },
    });

    // Use the app
    await use(electronApp);

    // Cleanup
    await electronApp.close();

    // Remove test database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(`${dbPath}-journal`)) {
      fs.unlinkSync(`${dbPath}-journal`);
    }
  },

  window: async ({ electronApp }, use) => {
    // Wait for the first window to open
    const window = await electronApp.firstWindow();

    // Wait for the app to be ready
    await window.waitForLoadState('domcontentloaded');

    // Optionally wait for specific element to ensure app is fully loaded
    try {
      await window.waitForSelector('[data-testid="app-ready"]', { timeout: 30000 });
    } catch {
      // App ready marker not found, continue anyway
      console.warn('App ready marker not found, proceeding with test');
    }

    await use(window);
  },

  testDataDir: async ({}, use) => {
    const testDataDir = process.env.NUVANA_TEST_DATA_DIR || path.join(process.cwd(), 'test-data', 'e2e');
    await use(testDataDir);
  },

  cleanup: async ({}, use) => {
    const cleanupFns: Array<() => Promise<void>> = [];

    const registerCleanup = (fn: () => Promise<void>): void => {
      cleanupFns.push(fn);
    };

    // Pass cleanup registration function to test
    await use(async () => {
      for (const fn of cleanupFns.reverse()) {
        await fn();
      }
    });

    // Run cleanup after test
    for (const fn of cleanupFns.reverse()) {
      await fn();
    }
  },
});

export { expect } from '@playwright/test';
