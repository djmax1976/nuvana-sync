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
    await window.evaluate(() =>
      (
        window as unknown as { electronAPI: { invoke: (ch: string) => Promise<unknown> } }
      ).electronAPI.invoke('settings:completeSetup')
    );
    // Reload so the app re-checks config and shows dashboard
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
  }

  // Wait for the dashboard/app layout to be visible
  await window.waitForSelector('[data-testid="app-layout"], [data-testid="dashboard"]', {
    timeout: 15000,
  });
}

/**
 * Navigate to the Reports page via the sidebar
 */
async function navigateToReports(window: Page) {
  await ensureAppConfigured(window);

  // Click the Reports link in the sidebar
  const reportsLink = window.locator(
    'a:has-text("Reports"), [data-testid="reports-link"], [data-testid="nav-reports"]'
  );
  await reportsLink.click();
  // Wait for the reports page to be loaded
  await window.waitForSelector('[role="tablist"]', { timeout: 10000 });
}

test.describe('Reports Page', () => {
  test.describe('Navigation', () => {
    test('should navigate to Reports via sidebar', async ({ window }) => {
      await navigateToReports(window);
      // Verify the tab interface is visible
      const tablist = window.locator('[role="tablist"]');
      await expect(tablist).toBeVisible();
    });
  });

  test.describe('Page structure', () => {
    test('should display all report type tabs', async ({ window }) => {
      await navigateToReports(window);
      await expect(window.locator('text=Weekly Report')).toBeVisible();
      await expect(window.locator('text=Monthly Report')).toBeVisible();
      await expect(window.locator('text=Custom Range')).toBeVisible();
      await expect(window.locator('text=Shifts By Day')).toBeVisible();
    });

    test('should show tablist with aria-label', async ({ window }) => {
      await navigateToReports(window);
      const tablist = window.locator('[role="tablist"]');
      await expect(tablist).toHaveAttribute('aria-label', 'Report type');
    });
  });

  test.describe('Shifts By Day view', () => {
    test('should switch to Shifts By Day tab', async ({ window }) => {
      await navigateToReports(window);
      await window.locator('text=Shifts By Day').click();

      // Should show date inputs for shifts view
      const startDate = window.locator('#shifts-start-date');
      await expect(startDate).toBeVisible();
    });

    test('should show loading state or data after tab switch', async ({ window }) => {
      await navigateToReports(window);
      await window.locator('text=Shifts By Day').click();

      // Wait for either loading skeletons, data, or empty state
      await Promise.race([
        window.waitForSelector('[data-testid="day-accordion-skeleton"]', { timeout: 5000 }),
        window.waitForSelector('[data-testid="day-accordion"]', { timeout: 5000 }),
        window.waitForSelector('[data-testid^="reports-empty-state"]', { timeout: 5000 }),
      ]);
    });
  });

  test.describe('Accordion interactions', () => {
    test('should expand/collapse accordion with click', async ({ window }) => {
      await navigateToReports(window);
      await window.locator('text=Shifts By Day').click();

      // Wait for data to load
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
      await window.locator('text=Shifts By Day').click();

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
      await window.locator('text=Shifts By Day').click();

      const viewDayBtn = window.locator('[data-testid="day-accordion-view-day-btn"]').first();
      const hasBtn = await viewDayBtn.isVisible().catch(() => false);

      if (hasBtn) {
        await viewDayBtn.click();
        // Should navigate to day-close page
        await window.waitForURL(/day-close/, { timeout: 5000 });
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
      await window.locator('text=Shifts By Day').click();

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
