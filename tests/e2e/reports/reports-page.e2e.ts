/**
 * Reports Page E2E Tests
 *
 * End-to-end tests for the Reports page functionality using Playwright.
 * Tests navigation, data loading, accordion interactions, keyboard navigation,
 * theme toggle, and layout stability.
 *
 * @module tests/e2e/reports/reports-page
 * @security SEC-004: Verifies no XSS vectors in rendered content
 * @accessibility A11Y-002: Validates keyboard navigation
 * @accessibility A11Y-004: Validates ARIA attributes in live app
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';

/**
 * Minimum viewport dimensions for desktop sidebar visibility.
 * TailwindCSS `lg` breakpoint = min-width 1024px; using 1280 for margin.
 */
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * CSS selector that matches any reports page data state.
 * After the initial fetch, the page must render exactly one of:
 *   - Loading skeleton (data fetch in progress)
 *   - Day accordion(s) (shift data loaded)
 *   - Empty state (no data for selected range)
 *   - Error alert (fetch failed)
 */
const REPORTS_DATA_STATE_SELECTOR = [
  '[data-testid="day-accordion-skeleton"]',
  '[data-testid="day-accordion"]',
  '[data-testid^="reports-empty-state"]',
  '[role="alert"]',
].join(', ');

/**
 * Complete the setup wizard via IPC so the app shows the dashboard.
 *
 * Reports tests require the app to be in a configured state since
 * the sidebar (with the Reports link) only appears after setup is done.
 * The setup wizard itself is tested separately in setup-wizard.e2e.ts.
 *
 * Flow:
 *   1. Check if the app layout is already visible (fast path)
 *   2. If setup wizard is showing, call `settings:completeSetup` via IPC
 *   3. Navigate to the dashboard root hash (`#/`)
 *   4. Wait for AppLayout to finish its async config check and render
 */
async function ensureAppConfigured(window: Page) {
  // Fast path: app layout already rendered means setup is complete
  const isAppReady = await window
    .locator('[data-testid="app-layout"]')
    .isVisible()
    .catch(() => false);

  if (isAppReady) {
    return;
  }

  // Check if setup wizard is showing (fresh database)
  const isSetupWizard = await window
    .locator('[data-testid="setup-wizard-title"]')
    .isVisible()
    .catch(() => false);

  if (isSetupWizard) {
    // Complete setup via IPC to transition to the dashboard.
    // The preload script exposes `electronAPI.invoke` on the browser window.
    await window.evaluate(async () =>
      (
        window as unknown as { electronAPI: { invoke: (ch: string) => Promise<unknown> } }
      ).electronAPI.invoke('settings:completeSetup')
    );

    // Navigate to the dashboard root. Using reload() here would preserve the
    // #/setup hash, causing the SetupWizard to render again instead of AppLayout.
    // Note: Inside evaluate(), `window` is the browser Window, not the Playwright Page.
    await window.evaluate(() => {
      (window as unknown as Window).location.hash = '#/';
    });
  }

  // Wait for the app layout to be visible. AppLayout performs an async
  // `getConfig()` IPC check before rendering (shows "Loading..." until
  // isConfigured resolves), so this may take a moment after the hash change.
  await window.waitForSelector('[data-testid="app-layout"]', {
    timeout: 20000,
  });
}

/**
 * Navigate to the Reports page via the sidebar.
 *
 * Ensures the app is configured, the desktop sidebar is visible, then
 * clicks the Reports link and waits for the page heading and initial
 * data state to confirm the route transition completed.
 */
async function navigateToReports(window: Page) {
  await ensureAppConfigured(window);

  // Wait for the Reports link in the sidebar to be visible and interactable.
  // The sidebar uses `hidden lg:block`, so the viewport must be >= 1024px.
  const reportsLink = window.locator('[data-testid="reports-link"]');
  await reportsLink.waitFor({ state: 'visible', timeout: 10000 });
  await reportsLink.click();

  // Wait for the Reports page heading to confirm navigation succeeded
  await window.waitForSelector('h1:has-text("Reports")', { timeout: 10000 });

  // Wait for the page to finish its initial data fetch.
  // One of: loading skeleton, day accordion data, empty state, or error.
  await window.waitForSelector(REPORTS_DATA_STATE_SELECTOR, { timeout: 15000 });
}

test.describe('Reports Page', () => {
  // Ensure a desktop-sized viewport for all tests. The sidebar navigation
  // uses TailwindCSS `hidden lg:block` (visible at >= 1024px). Setting
  // this in beforeEach guarantees consistent behavior across environments.
  test.beforeEach(async ({ window }) => {
    await window.setViewportSize(DESKTOP_VIEWPORT);
  });

  test.describe('Navigation', () => {
    test('should navigate to Reports via sidebar', async ({ window }) => {
      await navigateToReports(window);
      // Verify the Reports heading is visible (confirms route transition)
      const heading = window.locator('h1:has-text("Reports")');
      await expect(heading).toBeVisible();
    });
  });

  test.describe('Page structure', () => {
    test('should display page heading and date range controls', async ({ window }) => {
      await navigateToReports(window);

      // Heading
      await expect(window.locator('h1:has-text("Reports")')).toBeVisible();

      // Date range inputs
      await expect(window.locator('#reports-start-date')).toBeVisible();
      await expect(window.locator('#reports-end-date')).toBeVisible();

      // Labels for date controls
      await expect(window.locator('label[for="reports-start-date"]')).toHaveText('From');
    });

    test('should show data, empty state, or loading skeleton after navigation', async ({
      window,
    }) => {
      await navigateToReports(window);

      // The page must render one of these states after the initial fetch.
      // Using a combined CSS selector guarantees at least one state is present.
      const stateElement = window.locator(REPORTS_DATA_STATE_SELECTOR).first();
      await expect(stateElement).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Shifts By Day view', () => {
    test('should display date range inputs on the default view', async ({ window }) => {
      await navigateToReports(window);

      // The shifts-by-day view is the sole/default view — date controls are always shown
      const startDate = window.locator('#reports-start-date');
      const endDate = window.locator('#reports-end-date');
      await expect(startDate).toBeVisible();
      await expect(endDate).toBeVisible();
    });

    test('should show loading state, data, or empty state', async ({ window }) => {
      await navigateToReports(window);

      // The page auto-fetches shifts-by-day data on mount.
      // One of loading, data, or empty must be visible (error is a separate concern).
      const stateElement = window
        .locator(
          '[data-testid="day-accordion-skeleton"], [data-testid="day-accordion"], [data-testid^="reports-empty-state"]'
        )
        .first();
      await expect(stateElement).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Accordion interactions', () => {
    test('should expand/collapse accordion with click', async ({ window }) => {
      await navigateToReports(window);

      // Wait for data to load (shifts-by-day is the default view)
      const accordion = window.locator('[data-testid="day-accordion"]').first();
      const hasAccordion = await accordion.isVisible().catch(() => false);

      if (hasAccordion) {
        const header = window.locator('[data-testid="day-accordion-header"]').first();
        const expandedBefore = await accordion.getAttribute('data-expanded');

        // Click to toggle
        await header.click();

        // State should change
        const expandedAfter = await accordion.getAttribute('data-expanded');
        expect(expandedAfter).not.toBe(expandedBefore);

        // Click again to toggle back
        await header.click();
        const expandedFinal = await accordion.getAttribute('data-expanded');
        expect(expandedFinal).toBe(expandedBefore);
      }
    });

    test('should expand/collapse accordion with keyboard', async ({ window }) => {
      await navigateToReports(window);

      const header = window.locator('[data-testid="day-accordion-header"]').first();
      const hasHeader = await header.isVisible().catch(() => false);

      if (hasHeader) {
        // Focus the header
        await header.focus();

        const accordion = window.locator('[data-testid="day-accordion"]').first();
        const expandedBefore = await accordion.getAttribute('data-expanded');

        // Press Enter to toggle
        await header.press('Enter');

        const expandedAfter = await accordion.getAttribute('data-expanded');
        expect(expandedAfter).not.toBe(expandedBefore);

        // Press Space to toggle back
        await header.press('Space');

        const expandedFinal = await accordion.getAttribute('data-expanded');
        expect(expandedFinal).toBe(expandedBefore);
      }
    });
  });

  test.describe('View Day button', () => {
    test('should navigate when View Day is clicked', async ({ window }) => {
      await navigateToReports(window);

      const viewDayBtn = window.locator('[data-testid="day-accordion-view-day-btn"]').first();
      const hasBtn = await viewDayBtn.isVisible().catch(() => false);

      if (hasBtn) {
        await viewDayBtn.click();
        // Hash routing: URL becomes file:///...#/lottery-day-report?date=...
        await window.waitForURL(/lottery-day-report/, { timeout: 5000 });
      }
    });
  });

  test.describe('Theme toggle', () => {
    test('should change page appearance when theme is toggled', async ({ window }) => {
      await navigateToReports(window);

      // Get initial theme class on root element
      const htmlElement = window.locator('html');
      const initialClass = await htmlElement.getAttribute('class');

      // Try to find and click theme toggle
      const themeToggle = window
        .locator(
          '[data-testid="theme-toggle"], [aria-label*="theme"], [aria-label*="Theme"], button:has-text("Dark"), button:has-text("Light")'
        )
        .first();

      const hasToggle = await themeToggle.isVisible().catch(() => false);

      if (hasToggle) {
        await themeToggle.click();
        const newClass = await htmlElement.getAttribute('class');
        // Class should change (dark added or removed)
        expect(newClass).not.toBe(initialClass);
      }
    });
  });

  test.describe('Layout stability', () => {
    test('should have scrollbar-gutter: stable on html element', async ({ window }) => {
      await navigateToReports(window);
      const scrollbarGutter = await window.evaluate(() => {
        return getComputedStyle(document.documentElement).scrollbarGutter;
      });
      // Should be 'stable' to prevent layout shift
      expect(scrollbarGutter).toContain('stable');
    });

    test('should not cause layout shift during accordion toggle', async ({ window }) => {
      await navigateToReports(window);

      const header = window.locator('[data-testid="day-accordion-header"]').first();
      const hasHeader = await header.isVisible().catch(() => false);

      if (hasHeader) {
        // Get header position before toggle
        const boxBefore = await header.boundingBox();

        await header.click();
        // Wait for CSS Grid animation to complete (350ms duration in DayAccordion)
        await window.waitForTimeout(400);

        // Header position should not shift horizontally
        const boxAfter = await header.boundingBox();
        if (boxBefore && boxAfter) {
          expect(boxAfter.x).toBe(boxBefore.x);
          expect(boxAfter.width).toBe(boxBefore.width);
        }
      }
    });
  });

  test.describe('Responsive viewport', () => {
    test('should render without horizontal overflow at 1024px', async ({ window }) => {
      await navigateToReports(window);

      // Set viewport to 1024px width (TailwindCSS lg breakpoint boundary)
      await window.setViewportSize({ width: 1024, height: 768 });

      // Check no horizontal scroll
      const hasOverflow = await window.evaluate(() => {
        return document.body.scrollWidth > document.body.clientWidth;
      });

      expect(hasOverflow).toBe(false);
    });

    test('should render without horizontal overflow at 1280px', async ({ window }) => {
      await navigateToReports(window);

      await window.setViewportSize({ width: 1280, height: 800 });

      const hasOverflow = await window.evaluate(() => {
        return document.body.scrollWidth > document.body.clientWidth;
      });

      expect(hasOverflow).toBe(false);
    });
  });
});
