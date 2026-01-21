/**
 * Setup Wizard E2E Tests
 *
 * Tests the initial setup wizard flow including:
 * - Welcome screen display
 * - API key entry and validation
 * - Navigation between steps
 * - Accessibility
 *
 * @module tests/e2e/setup-wizard
 */

import { test, expect } from './fixtures/electron.fixture';

test.describe('Setup Wizard', () => {
  test.describe('Initial Launch', () => {
    test('should show setup wizard on first launch', async ({ window }) => {
      // Verify setup wizard is displayed (fresh install = not configured)
      const setupTitle = window.locator('[data-testid="setup-wizard-title"]');
      await expect(setupTitle).toBeVisible({ timeout: 15000 });
    });

    test('should display welcome step initially', async ({ window }) => {
      const welcomeStep = window.locator('[data-testid="setup-step-welcome"]');
      await expect(welcomeStep).toBeVisible({ timeout: 15000 });
    });

    test('should show Get Started button on welcome step', async ({ window }) => {
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await expect(nextButton).toBeVisible({ timeout: 15000 });
      await expect(nextButton).toContainText('Get Started');
    });
  });

  test.describe('API Key Step', () => {
    test('should navigate to API key step when clicking Get Started', async ({ window }) => {
      // Click Get Started button
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Verify API key step is shown
      const apiKeyStep = window.locator('[data-testid="setup-step-apikey"]');
      await expect(apiKeyStep).toBeVisible();
    });

    test('should mask API key input by default', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Check input type is password (masked)
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      const inputType = await apiKeyInput.getAttribute('type');

      expect(inputType).toBe('password');
    });

    test('should disable validate button when API key is empty', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Clear API key input
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      await apiKeyInput.fill('');

      // Validate button should be disabled
      const validateButton = window.locator('[data-testid="validate-api-key-button"]');
      await expect(validateButton).toBeDisabled();
    });

    test('should enable validate button when API key is entered', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Enter API key
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      await apiKeyInput.fill('test-api-key-12345');

      // Validate button should be enabled
      const validateButton = window.locator('[data-testid="validate-api-key-button"]');
      await expect(validateButton).toBeEnabled();
    });

    test('should show error for invalid API key', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Enter invalid API key
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      await apiKeyInput.fill('invalid-api-key-12345');

      // Click validate
      const validateButton = window.locator('[data-testid="validate-api-key-button"]');
      await validateButton.click();

      // Should show validation error (from API)
      const errorMessage = window.locator('[data-testid="api-key-error"]');
      await expect(errorMessage).toBeVisible({ timeout: 15000 });
    });

    test('should show advanced options when toggle is clicked', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Click the advanced options toggle (not the password visibility toggle)
      const advancedToggle = window.locator('[data-testid="toggle-advanced-options"]');
      await advancedToggle.click();

      // API URL input should appear when advanced options are expanded
      const apiUrlInput = window.locator('input[placeholder*="api.nuvanaapp.com"]');
      await expect(apiUrlInput).toBeVisible();
    });

    test('should toggle API key visibility when eye icon is clicked', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // API key input should initially be password type (hidden)
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      await expect(apiKeyInput).toHaveAttribute('type', 'password');

      // Click the visibility toggle (Eye icon)
      const visibilityToggle = window.locator('[data-testid="toggle-api-key-visibility"]');
      await visibilityToggle.click();

      // API key input should now be text type (visible)
      await expect(apiKeyInput).toHaveAttribute('type', 'text');

      // Click again to hide
      await visibilityToggle.click();

      // Should be password type again
      await expect(apiKeyInput).toHaveAttribute('type', 'password');
    });
  });

  test.describe('Navigation', () => {
    test('should allow going back to welcome step', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Should be able to go back
      const backButton = window.locator('[data-testid="setup-back-button"]');
      await expect(backButton).toBeVisible();
      await backButton.click();

      // Should be back on welcome step
      const welcomeStep = window.locator('[data-testid="setup-step-welcome"]');
      await expect(welcomeStep).toBeVisible();
    });

    test('should preserve entered API key when navigating back and forward', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Enter API key
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      const testApiKey = 'test-api-key-12345';
      await apiKeyInput.fill(testApiKey);

      // Go back
      const backButton = window.locator('[data-testid="setup-back-button"]');
      await backButton.click();

      // Go forward again
      await nextButton.click();

      // API key should still be there
      const apiKeyValue = await apiKeyInput.inputValue();
      expect(apiKeyValue).toBe(testApiKey);
    });
  });

  test.describe('Accessibility', () => {
    test('should support keyboard navigation', async ({ window }) => {
      // Wait for page to load
      await window.waitForLoadState('domcontentloaded');

      // Tab should move focus
      await window.keyboard.press('Tab');

      // Should have a focused element
      const focusedElement = window.locator(':focus');
      const tagName = await focusedElement.evaluate((el) => el.tagName);

      // Focused element should be interactive
      expect(['BUTTON', 'INPUT', 'A']).toContain(tagName);
    });

    test('should activate button with Enter key', async ({ window }) => {
      // Wait for welcome step
      const welcomeStep = window.locator('[data-testid="setup-step-welcome"]');
      await expect(welcomeStep).toBeVisible({ timeout: 15000 });

      // Tab to the Get Started button
      await window.keyboard.press('Tab');

      // Press Enter to activate
      await window.keyboard.press('Enter');

      // Should navigate to API key step
      const apiKeyStep = window.locator('[data-testid="setup-step-apikey"]');
      await expect(apiKeyStep).toBeVisible();
    });
  });
});
