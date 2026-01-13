/**
 * Setup Wizard E2E Tests
 *
 * Tests the initial setup wizard flow including:
 * - API key validation
 * - Store configuration
 * - Folder selection
 * - Setup completion
 *
 * @module tests/e2e/setup-wizard
 */

import { test, expect } from './fixtures/electron.fixture';

test.describe('Setup Wizard', () => {
  test.describe('Initial Launch', () => {
    test('should show setup wizard on first launch', async ({ window }) => {
      // Verify setup wizard is displayed
      const setupTitle = window.locator('[data-testid="setup-wizard-title"]');
      await expect(setupTitle).toBeVisible({ timeout: 10000 });
    });

    test('should display welcome step initially', async ({ window }) => {
      const welcomeStep = window.locator('[data-testid="setup-step-welcome"]');
      await expect(welcomeStep).toBeVisible();
    });
  });

  test.describe('API Key Validation', () => {
    test('should show error for empty API key', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Try to submit empty API key
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      await apiKeyInput.fill('');

      const validateButton = window.locator('[data-testid="validate-api-key-button"]');
      await validateButton.click();

      // Should show validation error
      const errorMessage = window.locator('[data-testid="api-key-error"]');
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toContainText('required');
    });

    test('should show error for invalid API key', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Enter invalid API key
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      await apiKeyInput.fill('invalid-api-key-12345');

      const validateButton = window.locator('[data-testid="validate-api-key-button"]');
      await validateButton.click();

      // Should show validation error (from API)
      const errorMessage = window.locator('[data-testid="api-key-error"]');
      await expect(errorMessage).toBeVisible({ timeout: 15000 });
    });

    test('should mask API key input', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      // Check input type is password (masked)
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');
      const inputType = await apiKeyInput.getAttribute('type');

      expect(inputType).toBe('password');
    });

    test('should allow toggling API key visibility', async ({ window }) => {
      // Navigate to API key step
      const nextButton = window.locator('[data-testid="setup-next-button"]');
      await nextButton.click();

      const toggleButton = window.locator('[data-testid="toggle-api-key-visibility"]');
      const apiKeyInput = window.locator('[data-testid="api-key-input"]');

      // Initially masked
      let inputType = await apiKeyInput.getAttribute('type');
      expect(inputType).toBe('password');

      // Toggle to visible
      await toggleButton.click();
      inputType = await apiKeyInput.getAttribute('type');
      expect(inputType).toBe('text');

      // Toggle back to masked
      await toggleButton.click();
      inputType = await apiKeyInput.getAttribute('type');
      expect(inputType).toBe('password');
    });
  });

  test.describe('Folder Selection', () => {
    test('should allow manual folder path entry', async ({ window, testDataDir }) => {
      // Skip to folder selection step (requires valid API key flow)
      // For unit testing, we may need to mock the API validation

      // This test validates the folder input field behavior
      const folderInput = window.locator('[data-testid="watch-folder-input"]');

      // Should accept valid path
      await folderInput.fill(testDataDir);

      // Should not show error for valid path
      const errorMessage = window.locator('[data-testid="folder-error"]');
      await expect(errorMessage).not.toBeVisible();
    });

    test('should reject path traversal attempts', async ({ window }) => {
      // Navigate to folder selection step
      const folderInput = window.locator('[data-testid="watch-folder-input"]');
      await folderInput.fill('../../../etc/passwd');

      const validateButton = window.locator('[data-testid="validate-folder-button"]');
      await validateButton.click();

      // Should show security error
      const errorMessage = window.locator('[data-testid="folder-error"]');
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toContainText('Invalid');
    });
  });

  test.describe('Navigation', () => {
    test('should allow going back to previous steps', async ({ window }) => {
      // Navigate forward
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

    test('should preserve entered data when navigating back and forward', async ({ window }) => {
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
      // Should be able to tab through elements
      await window.keyboard.press('Tab');
      await window.keyboard.press('Tab');

      // Should be able to activate buttons with Enter
      const focusedElement = window.locator(':focus');
      const tagName = await focusedElement.evaluate((el) => el.tagName);

      // Focused element should be interactive
      expect(['BUTTON', 'INPUT', 'A']).toContain(tagName);
    });

    test('should have proper focus indicators', async ({ window }) => {
      // Tab to an element
      await window.keyboard.press('Tab');

      // Check that focused element has visible focus indicator
      const focusedElement = window.locator(':focus');
      const outlineStyle = await focusedElement.evaluate(
        (el) => getComputedStyle(el).outlineWidth
      );

      // Should have visible outline (not 0px)
      expect(outlineStyle).not.toBe('0px');
    });
  });
});
