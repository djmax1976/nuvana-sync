/**
 * Electron Test Fixtures
 *
 * Provides Playwright fixtures for testing Electron applications.
 * Sets up and tears down ElectronApplication instances.
 *
 * @module tests/e2e/fixtures/electron
 */

/* eslint-disable react-hooks/rules-of-hooks */
// Note: Playwright's `use` function triggers false positives for react-hooks/rules-of-hooks

import {
  test as base,
  type Page,
  type ElectronApplication,
  _electron as electron,
} from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Determine if running in CI environment
const isCI = !!process.env.CI;

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
  const testDataDir =
    process.env.NUVANA_TEST_DATA_DIR || path.join(process.cwd(), 'test-data', 'e2e');
  const sanitizedName = testName.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(testDataDir, `test_${sanitizedName}_${Date.now()}.db`);
}

/**
 * Get the correct app launch path based on environment
 * - CI: Use packaged app from release/win-unpacked/Nuvana.exe
 * - Local: Use built app from out/main/index.js
 */
function getAppLaunchConfig(): { executablePath?: string; args: string[] } {
  const packagedAppPath = path.join(process.cwd(), 'release', 'win-unpacked', 'Nuvana.exe');
  const devAppPath = path.join(process.cwd(), 'out', 'main', 'index.js');

  // In CI, prefer the packaged app (downloaded from build job)
  if (isCI && fs.existsSync(packagedAppPath)) {
    return {
      executablePath: packagedAppPath,
      args: [],
    };
  }

  // In development or if packaged app doesn't exist, use dev build
  return {
    args: [devAppPath],
  };
}

/**
 * Electron test fixture configuration
 */
export const test = base.extend<ElectronTestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use, testInfo) => {
    // Create isolated test database
    const dbPath = createTestDatabasePath(testInfo.title);

    // Get the correct launch configuration
    const launchConfig = getAppLaunchConfig();

    // Launch Electron app
    const electronApp = await electron.launch({
      ...launchConfig,
      args: [...launchConfig.args, '--test-mode', `--test-db-path=${dbPath}`],
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

    // Wait for the app to finish loading (setup wizard or dashboard)
    // The app shows either setup-wizard-title or dashboard content
    try {
      await Promise.race([
        window.waitForSelector('[data-testid="setup-wizard-title"]', { timeout: 30000 }),
        window.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 }),
        window.waitForSelector('h1:has-text("Nuvana")', { timeout: 30000 }),
      ]);
    } catch {
      // If none found, wait a bit and continue
      console.warn('App ready indicator not found, waiting for load state');
      await window.waitForLoadState('networkidle');
    }

    await use(window);
  },

  // eslint-disable-next-line no-empty-pattern
  testDataDir: async ({}, use) => {
    const testDataDir =
      process.env.NUVANA_TEST_DATA_DIR || path.join(process.cwd(), 'test-data', 'e2e');
    await use(testDataDir);
  },

  // eslint-disable-next-line no-empty-pattern
  cleanup: async ({}, use) => {
    const cleanupFns: Array<() => Promise<void>> = [];

    const _registerCleanup = (fn: () => Promise<void>): void => {
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
