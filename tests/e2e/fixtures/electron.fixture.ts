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

// Timeout for closing the Electron app during teardown (ms)
const APP_CLOSE_TIMEOUT = 10000;

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
 * - Local: Use built app from dist/main/index.js (electron-vite build output)
 */
function getAppLaunchConfig(): { executablePath?: string; args: string[] } {
  const packagedAppPath = path.join(process.cwd(), 'release', 'win-unpacked', 'Nuvana.exe');
  // electron-vite.config.ts outputs to dist/ (not out/)
  const devAppPath = path.join(process.cwd(), 'dist', 'main', 'index.js');

  // In CI, prefer the packaged app (downloaded from build job)
  if (isCI && fs.existsSync(packagedAppPath)) {
    console.log(`[e2e] Using packaged app: ${packagedAppPath}`);
    return {
      executablePath: packagedAppPath,
      args: [],
    };
  }

  // Locally, prefer the dev build for faster iteration. The packaged app
  // may be stale (built from a different commit) and reject newer CLI flags
  // like --test-mode. In CI, the packaged app is always freshly built.
  if (!isCI && fs.existsSync(devAppPath)) {
    console.log(`[e2e] Using dev build: ${devAppPath}`);
    return {
      args: [devAppPath],
    };
  }

  // Fall back to packaged app
  if (fs.existsSync(packagedAppPath)) {
    console.log(`[e2e] Using packaged app: ${packagedAppPath}`);
    return {
      executablePath: packagedAppPath,
      args: [],
    };
  }

  throw new Error(
    `[e2e] No launchable app found.\n` +
      `  Checked dev build: ${devAppPath} (not found)\n` +
      `  Checked packaged app: ${packagedAppPath} (not found)\n` +
      `  Run "npm run build" or "npm run build:win:unsigned" first.`
  );
}

/**
 * Close Electron app with a timeout to prevent teardown from hanging forever.
 * If graceful close doesn't work, force-kill the process.
 */
async function closeApp(electronApp: ElectronApplication): Promise<void> {
  try {
    const closePromise = electronApp.close();
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), APP_CLOSE_TIMEOUT)
    );

    const result = await Promise.race([closePromise, timeoutPromise]);

    if (result === 'timeout') {
      console.warn('[e2e] App close timed out, force-killing process');
      try {
        const pid = electronApp.process().pid;
        if (pid) {
          process.kill(pid, 'SIGKILL');
        }
      } catch {
        // Process already dead, that's fine
      }
    }
  } catch {
    // App may have already exited or crashed - that's OK during teardown
    console.warn('[e2e] App close threw an error (app may have already exited)');
  }
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

    // Capture stderr for diagnostics
    let launchError: Error | null = null;

    // Launch Electron app
    let electronApp: ElectronApplication;
    try {
      const launchArgs = [...launchConfig.args, '--test-mode', `--test-db-path=${dbPath}`];
      // Disable GPU on CI to prevent display/rendering failures on headless runners
      if (isCI) {
        launchArgs.push('--disable-gpu', '--disable-software-rasterizer');
      }

      // Build env: spread process.env then remove VSCode's ELECTRON_RUN_AS_NODE
      // which forces the Electron binary to run as plain Node.js (breaking the API).
      const launchEnv: Record<string, string> = {
        ...process.env,
        NUVANA_TEST_MODE: 'true',
        NUVANA_TEST_DB_PATH: dbPath,
        NODE_ENV: 'test',
      } as Record<string, string>;
      delete launchEnv.ELECTRON_RUN_AS_NODE;

      electronApp = await electron.launch({
        ...launchConfig,
        args: launchArgs,
        env: launchEnv,
        timeout: 30000,
      });
    } catch (error) {
      launchError = error as Error;
      console.error(`[e2e] Failed to launch Electron app: ${launchError.message}`);
      console.error(`[e2e] Launch config:`, JSON.stringify(launchConfig, null, 2));
      throw launchError;
    }

    // Listen for app crashes
    electronApp.process().on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`[e2e] Electron process exited with code ${code}`);
      }
    });

    // Use the app
    await use(electronApp);

    // Cleanup - use timeout-protected close
    await closeApp(electronApp);

    // Remove test database
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      if (fs.existsSync(`${dbPath}-journal`)) {
        fs.unlinkSync(`${dbPath}-journal`);
      }
    } catch {
      // Best-effort cleanup
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
      console.warn('[e2e] App ready indicator not found, waiting for load state');
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
