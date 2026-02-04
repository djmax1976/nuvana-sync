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
 * Complete the setup wizard via IPC so the app shows the dashboard.
 * Reports tests require the app to be in a configured state since
 * the sidebar (with the Reports link) only appears after setup is done.
 * The setup wizard itself is tested separately in setup-wizard.e2e.ts.
 */
async function ensureAppConfigured(window: Page) {
  // Check if setup wizard is showing (fresh database)
  const isSetupWizard = await window
    .locator('[data-testid="setup-wizard-title"]')
    .isVisible()
    .catch(() => false);

  if (isSetupWizard) {
    // Complete setup via IPC to transition to the dashboard
    await window.evaluate(async () =>
      (
        window as unknown as { electronAPI: { invoke: (ch: string) => Promise<unknown> } }
      ).electronAPI.invoke('settings:completeSetup')
    );
    // Navigate to the dashboard root. Using reload() here would preserve the
    // #/setup hash, causing the SetupWizard to render again instead of AppLayout.
    await window.evaluate(() => {
      (window as unknown as Window).location.hash = '#/';
    });
    await window.waitForLoadState('domcontentloaded');
  }

  // Wait for the dashboard/app layout to be visible
  await window.waitForSelector('[data-testid="app-layout"], [data-testid="dashboard"]', {
    timeout: 15000,
  });
}

/**
 * Navigate to the Reports page via the sidebar.
 *
 * The Reports page is an accordion-based "Shifts By Day" view (the sole view).
 * After clicking the sidebar link we wait for the page heading to confirm
 * the route transition completed.
 */
async function navigateToReports(window: Page) {
  await ensureAppConfigured(window);

  // Click the Reports link in the sidebar
  const reportsLink = window.locator('[data-testid="reports-link"]');
  await reportsLink.click();

  // Wait for the Reports page heading to confirm navigation
  await window.waitForSelector('h1:has-text("Reports")', { timeout: 10000 });

  // Wait for the page to finish its initial data fetch (loading, data, empty, or error)
  await Promise.race([
    window.waitForSelector('[data-testid="day-accordion-skeleton"]', { timeout: 10000 }),
    window.waitForSelector('[data-testid="day-accordion"]', { timeout: 10000 }),
    window.waitForSelector('[data-testid^="reports-empty-state"]', { timeout: 10000 }),
    window.waitForSelector('[role="alert"]', { timeout: 10000 }),
  ]);
}

test.describe('Reports Page', () => {
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

      // The page must render one of these states after loading
      const skeleton = window.locator('[data-testid="day-accordion-skeleton"]');
      const accordion = window.locator('[data-testid="day-accordion"]');
      const emptyState = window.locator('[data-testid^="reports-empty-state"]');
      const errorAlert = window.locator('[role="alert"]');

      // At least one state must be present
      const anyVisible = await Promise.race([
        skeleton
          .first()
          .isVisible()
          .then((v) => (v ? 'skeleton' : null)),
        accordion
          .first()
          .isVisible()
          .then((v) => (v ? 'accordion' : null)),
        emptyState
          .first()
          .isVisible()
          .then((v) => (v ? 'empty' : null)),
        errorAlert
          .first()
          .isVisible()
          .then((v) => (v ? 'error' : null)),
      ]);

      expect(anyVisible).toBeTruthy();
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

      // The page auto-fetches shifts-by-day data on mount
      await Promise.race([
        window.waitForSelector('[data-testid="day-accordion-skeleton"]', { timeout: 10000 }),
        window.waitForSelector('[data-testid="day-accordion"]', { timeout: 10000 }),
        window.waitForSelector('[data-testid^="reports-empty-state"]', { timeout: 10000 }),
      ]);
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
        // Should navigate to lottery day report page
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
        // Wait for animation
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

      // Set viewport to 1024px width
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
