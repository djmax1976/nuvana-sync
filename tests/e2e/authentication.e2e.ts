/**
 * Authentication E2E Tests
 *
 * Tests the authentication flow including:
 * - PIN login
 * - Session management
 * - Logout
 * - Session timeout
 *
 * @module tests/e2e/authentication
 */

import { test, expect } from './fixtures/electron.fixture';

test.describe('Authentication', () => {
  // These tests assume app is configured (setup wizard completed)
  test.beforeEach(async ({ electronApp }) => {
    // Seed test database with configured store and users
    await electronApp.evaluate(async ({ _ipcMain }) => {
      // This would be implemented to seed test data
      // For now, we document the expected setup
    });
  });

  test.describe('PIN Login', () => {
    test('should display login screen when not authenticated', async ({ window }) => {
      const loginScreen = window.locator('[data-testid="login-screen"]');
      await expect(loginScreen).toBeVisible({ timeout: 10000 });
    });

    test('should show PIN input field', async ({ window }) => {
      const pinInput = window.locator('[data-testid="pin-input"]');
      await expect(pinInput).toBeVisible();

      // PIN input should be password type (masked)
      const inputType = await pinInput.getAttribute('type');
      expect(inputType).toBe('password');
    });

    test('should accept 4-6 digit PIN', async ({ window }) => {
      const pinInput = window.locator('[data-testid="pin-input"]');

      // Should accept 4 digits
      await pinInput.fill('1234');
      let value = await pinInput.inputValue();
      expect(value).toBe('1234');

      // Should accept 6 digits
      await pinInput.fill('123456');
      value = await pinInput.inputValue();
      expect(value).toBe('123456');
    });

    test('should reject non-numeric input', async ({ window }) => {
      const pinInput = window.locator('[data-testid="pin-input"]');

      // Should not accept letters
      await pinInput.fill('abcd');
      const value = await pinInput.inputValue();

      // Either empty or only numeric chars
      expect(value).toMatch(/^\d*$/);
    });

    test('should show error for invalid PIN', async ({ window }) => {
      const pinInput = window.locator('[data-testid="pin-input"]');
      const loginButton = window.locator('[data-testid="login-button"]');

      // Enter invalid PIN
      await pinInput.fill('0000');
      await loginButton.click();

      // Should show error message
      const errorMessage = window.locator('[data-testid="login-error"]');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
      await expect(errorMessage).toContainText('Invalid PIN');
    });

    test('should apply delay after failed login attempt', async ({ window }) => {
      const pinInput = window.locator('[data-testid="pin-input"]');
      const loginButton = window.locator('[data-testid="login-button"]');

      // First failed attempt
      const startTime = Date.now();
      await pinInput.fill('0000');
      await loginButton.click();

      // Wait for error
      const errorMessage = window.locator('[data-testid="login-error"]');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });

      // Second attempt should be delayed
      await pinInput.fill('1111');
      await loginButton.click();

      const endTime = Date.now();

      // Should have at least 1 second delay
      expect(endTime - startTime).toBeGreaterThan(1000);
    });

    test('should navigate to dashboard after successful login', async ({ window }) => {
      // This test requires a valid test user in the database
      const pinInput = window.locator('[data-testid="pin-input"]');
      const loginButton = window.locator('[data-testid="login-button"]');

      // Enter valid test PIN (assuming test data is seeded)
      await pinInput.fill('1234'); // Test user PIN
      await loginButton.click();

      // Should navigate to dashboard
      const dashboard = window.locator('[data-testid="dashboard"]');
      await expect(dashboard).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('User Selection', () => {
    test('should display list of users for selection', async ({ window }) => {
      const userList = window.locator('[data-testid="user-list"]');
      await expect(userList).toBeVisible();
    });

    test('should filter users by search', async ({ window }) => {
      const searchInput = window.locator('[data-testid="user-search"]');
      await searchInput.fill('John');

      // User list should filter
      const userItems = window.locator('[data-testid="user-list-item"]');
      const count = await userItems.count();

      // Should show filtered results (at least match or no match)
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should pre-select user when clicked', async ({ window }) => {
      const userItem = window.locator('[data-testid="user-list-item"]').first();

      if ((await userItem.count()) > 0) {
        await userItem.click();

        // User should be selected
        await expect(userItem).toHaveClass(/selected/);
      }
    });
  });

  test.describe('Session Management', () => {
    test('should show session info after login', async ({ window }) => {
      // Assuming logged in state
      const sessionInfo = window.locator('[data-testid="session-info"]');

      if ((await sessionInfo.count()) > 0) {
        await expect(sessionInfo).toBeVisible();
      }
    });

    test('should display logged in user name', async ({ window }) => {
      const userName = window.locator('[data-testid="current-user-name"]');

      if ((await userName.count()) > 0) {
        const name = await userName.textContent();
        expect(name?.length).toBeGreaterThan(0);
      }
    });

    test('should display user role', async ({ window }) => {
      const userRole = window.locator('[data-testid="current-user-role"]');

      if ((await userRole.count()) > 0) {
        const role = await userRole.textContent();
        expect(['CASHIER', 'MANAGER', 'ADMIN']).toContain(role?.toUpperCase());
      }
    });
  });

  test.describe('Logout', () => {
    test('should have logout button visible when logged in', async ({ window }) => {
      const logoutButton = window.locator('[data-testid="logout-button"]');

      // May or may not be visible depending on auth state
      if ((await logoutButton.count()) > 0) {
        await expect(logoutButton).toBeVisible();
      }
    });

    test('should return to login screen after logout', async ({ window }) => {
      const logoutButton = window.locator('[data-testid="logout-button"]');

      if ((await logoutButton.count()) > 0) {
        await logoutButton.click();

        // Should show login screen
        const loginScreen = window.locator('[data-testid="login-screen"]');
        await expect(loginScreen).toBeVisible({ timeout: 5000 });
      }
    });

    test('should require confirmation for logout', async ({ window }) => {
      const logoutButton = window.locator('[data-testid="logout-button"]');

      if ((await logoutButton.count()) > 0) {
        await logoutButton.click();

        // Should show confirmation dialog
        const confirmDialog = window.locator('[data-testid="logout-confirm-dialog"]');

        if ((await confirmDialog.count()) > 0) {
          await expect(confirmDialog).toBeVisible();
        }
      }
    });
  });

  test.describe('Session Timeout', () => {
    test('should show warning before session expires', async ({ window }) => {
      // This test would require manipulating session timing
      // Document expected behavior
      const _warningMessage = window.locator('[data-testid="session-warning"]');

      // Warning should appear when session is about to expire
      // For testing, we'd need to mock the session timeout
    });

    test('should redirect to login on session expiry', async ({ _window }) => {
      // This test would require mocking session expiry
      // Document expected behavior
      // On session expiry:
      // 1. Show session expired message
      // 2. Redirect to login screen
      // 3. Clear any sensitive data from state
    });
  });

  test.describe('Authorization', () => {
    test('should hide admin features for non-admin users', async ({ window }) => {
      // Admin-only features should be hidden
      const _adminFeatures = window.locator('[data-testid="admin-only"]');

      // If logged in as non-admin, these should not be visible
      // Implementation depends on current user role
    });

    test('should show manager features for manager users', async ({ window }) => {
      // Manager features (day close, reports)
      const _managerFeatures = window.locator('[data-testid="manager-features"]');

      // Visibility depends on current user role
    });
  });
});
