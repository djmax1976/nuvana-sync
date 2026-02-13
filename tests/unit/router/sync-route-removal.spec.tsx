/**
 * Router — Sync Route Removal Tests
 *
 * Verifies that the /sync route has been removed from the router configuration
 * and that no redirect or fallback exists for it. Also verifies the /settings
 * route remains intact.
 *
 * Regression Coverage:
 * - ROUTE-001: /sync route does not exist
 * - ROUTE-002: /settings route exists and renders SettingsPage
 * - ROUTE-003: No redirect from /sync to /settings
 * - ROUTE-004: SyncMonitorPage is not imported in router
 *
 * @module tests/unit/router/sync-route-removal
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Static Analysis Tests (Source Code Verification)
// ============================================================================

const routerSource = readFileSync(
  resolve(__dirname, '../../../src/renderer/router.tsx'),
  'utf-8'
);

describe('Router — Sync Route Removal', () => {
  // --------------------------------------------------------------------------
  // ROUTE-001: /sync route removed
  // --------------------------------------------------------------------------

  describe('ROUTE-001: /sync route removed', () => {
    it('should not have a sync path in the route configuration', () => {
      // Check that no route path: 'sync' exists
      expect(routerSource).not.toMatch(/path:\s*['"]sync['"]/);
    });

    it('should not have a /sync path in the route configuration', () => {
      expect(routerSource).not.toMatch(/path:\s*['"]\/sync['"]/);
    });
  });

  // --------------------------------------------------------------------------
  // ROUTE-002: /settings route exists
  // --------------------------------------------------------------------------

  describe('ROUTE-002: /settings route exists', () => {
    it('should have a settings path in the route configuration', () => {
      expect(routerSource).toMatch(/path:\s*['"]settings['"]/);
    });

    it('should import SettingsPage', () => {
      expect(routerSource).toMatch(/import\(['"]\.\/pages\/SettingsPage['"]\)/);
    });
  });

  // --------------------------------------------------------------------------
  // ROUTE-003: No redirect from /sync
  // --------------------------------------------------------------------------

  describe('ROUTE-003: No redirect from /sync', () => {
    it('should not have a Navigate element pointing from sync to settings', () => {
      // If there were a redirect, we'd see 'sync' path with Navigate
      // Since the route is fully removed, both checks pass
      expect(routerSource).not.toMatch(/sync[\s\S]{0,100}Navigate/);
    });
  });

  // --------------------------------------------------------------------------
  // ROUTE-004: SyncMonitorPage not imported
  // --------------------------------------------------------------------------

  describe('ROUTE-004: SyncMonitorPage not imported', () => {
    it('should not import SyncMonitorPage', () => {
      expect(routerSource).not.toMatch(/import.*SyncMonitorPage/);
    });

    it('should have a comment explaining Sync Monitor is in Settings', () => {
      expect(routerSource).toMatch(/Sync Monitor.*Settings/i);
    });
  });

  // --------------------------------------------------------------------------
  // Existing routes preserved
  // --------------------------------------------------------------------------

  describe('Existing Routes Preserved', () => {
    const expectedPaths = [
      'dashboard',
      'mystore',
      'clock-in-out',
      'lottery',
      'terminals',
      'employees',
      'shifts',
      'transactions',
      'reports',
      'settings',
      'shift-end',
      'day-close',
    ];

    expectedPaths.forEach((path) => {
      it(`should have route for /${path}`, () => {
        expect(routerSource).toMatch(new RegExp(`path:\\s*['"]${path}['"]`));
      });
    });
  });
});
