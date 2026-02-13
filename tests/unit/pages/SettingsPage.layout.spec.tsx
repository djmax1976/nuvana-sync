/**
 * Settings Page Layout Tests
 *
 * Tests the two-column layout restructuring of the Settings page.
 * Verifies that SyncMonitorPanel is embedded on the left and settings
 * forms are on the right, with proper responsive behavior.
 *
 * Layout Coverage:
 * - LAYOUT-001: Two-column flex layout structure
 * - LAYOUT-002: SyncMonitorPanel is rendered in left column
 * - LAYOUT-003: Settings forms are in right column
 * - LAYOUT-004: Header renders with back button and title
 * - LAYOUT-005: CloudProtectedPage wraps content (auth gate)
 * - LAYOUT-006: Responsive classes for xl breakpoint
 *
 * @module tests/unit/pages/SettingsPage.layout
 * @security SEC-001: Verifies CloudProtectedPage auth wrapper is present
 * @security SEC-004: No XSS vectors — all content is text via React escaping
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock CloudProtectedPage — immediately renders children with mock user
vi.mock('../../../src/renderer/components/auth/CloudProtectedPage', () => ({
  CloudProtectedPage: ({
    children,
    requiredRoles,
  }: {
    children: (user: { email: string; role: string }) => React.ReactNode;
    requiredRoles: string[];
    title?: string;
    description?: string;
  }) => (
    <div data-testid="cloud-protected-page" data-roles={requiredRoles.join(',')}>
      {children({ email: 'support@nuvana.com', role: 'SUPPORT' })}
    </div>
  ),
}));

// Mock SyncMonitorPanel — simple stub to verify it's rendered
vi.mock('../../../src/renderer/components/sync/SyncMonitorPanel', () => ({
  SyncMonitorPanel: ({ className }: { className?: string }) => (
    <div data-testid="sync-monitor-panel" className={className}>
      Sync Monitor Panel Stub
    </div>
  ),
}));

// Mock ResetStoreDialog
vi.mock('../../../src/renderer/components/settings/ResetStoreDialog', () => ({
  ResetStoreDialog: () => <div data-testid="reset-store-dialog" />,
}));

// Mock window.electronAPI
const mockInvoke = vi.fn();
const mockOn = vi.fn();

Object.defineProperty(window, 'electronAPI', {
  value: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: vi.fn(),
  },
  writable: true,
  configurable: true,
});

// Import component AFTER all mocks
import Settings from '../../../src/renderer/pages/Settings';

// ============================================================================
// Test Helpers
// ============================================================================

function setupElectronMocks() {
  // Mock invoke responses for settings page initialization
  mockInvoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'config:get':
        return Promise.resolve({
          apiKey: 'test-key',
          posConnection: {
            type: 'network',
            host: 'localhost',
            port: 9100,
            timeout: 5000,
          },
          pollIntervalSeconds: 60,
          reprocessIntervalMinutes: 5,
          businessDayCutoffTime: '06:00',
          syncFileTypes: {
            journal: true,
            electronic_journal: false,
            plu: true,
            fuel: false,
          },
          watchFolderPath: 'C:\\data',
          behavior: {
            autoStartSync: true,
            showNotifications: true,
          },
        });
      case 'store:getInfo':
        return Promise.resolve({
          storeId: 'store-uuid-123',
          storeName: 'Test Store',
          companyName: 'Test Company',
          timezone: 'America/New_York',
        });
      case 'sync:triggerPull':
        return Promise.resolve({ success: true });
      default:
        return Promise.resolve(null);
    }
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Settings Page Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronMocks();
  });

  // --------------------------------------------------------------------------
  // LAYOUT-005: CloudProtectedPage Auth Gate
  // --------------------------------------------------------------------------

  describe('Auth Gate', () => {
    it('should wrap content with CloudProtectedPage', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      expect(protectedPage).toBeInTheDocument();
    });

    it('should require SUPPORT and SUPERADMIN roles', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      expect(protectedPage).toHaveAttribute('data-roles', 'SUPPORT,SUPERADMIN');
    });
  });

  // --------------------------------------------------------------------------
  // LAYOUT-004: Header
  // --------------------------------------------------------------------------

  describe('Header', () => {
    it('should render Settings title', () => {
      render(<Settings onBack={vi.fn()} />);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('should render back button with aria-label', () => {
      render(<Settings onBack={vi.fn()} />);
      const backButton = screen.getByRole('button', { name: /go back/i });
      expect(backButton).toBeInTheDocument();
    });

    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn();
      render(<Settings onBack={onBack} />);
      fireEvent.click(screen.getByRole('button', { name: /go back/i }));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // LAYOUT-002: SyncMonitorPanel Embedded
  // --------------------------------------------------------------------------

  describe('SyncMonitorPanel Integration', () => {
    it('should render SyncMonitorPanel', () => {
      render(<Settings onBack={vi.fn()} />);
      expect(screen.getByTestId('sync-monitor-panel')).toBeInTheDocument();
    });

    it('should render SyncMonitorPanel content', () => {
      render(<Settings onBack={vi.fn()} />);
      expect(screen.getByText('Sync Monitor Panel Stub')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // LAYOUT-001 & LAYOUT-006: Two-Column Flex Layout
  // --------------------------------------------------------------------------

  describe('Two-Column Layout', () => {
    it('should have the outer container with h-full flex-col', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      // The first child of CloudProtectedPage wrapper is the settings content
      const settingsRoot = protectedPage.firstElementChild as HTMLElement;
      expect(settingsRoot).toBeTruthy();
      expect(settingsRoot.className).toContain('flex');
      expect(settingsRoot.className).toContain('flex-col');
      expect(settingsRoot.className).toContain('h-full');
    });

    it('should have a content area with xl:flex-row for side-by-side columns', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      // Find the two-column container
      const twoColContainer = protectedPage.querySelector('.xl\\:flex-row');
      expect(twoColContainer).toBeTruthy();
    });

    it('should have xl responsive overflow classes for independent scrolling', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      // Container should have xl:overflow-hidden
      const twoColContainer = protectedPage.querySelector('.xl\\:overflow-hidden');
      expect(twoColContainer).toBeTruthy();
      // Individual columns should have xl:overflow-y-auto
      const scrollableColumns = protectedPage.querySelectorAll('.xl\\:overflow-y-auto');
      expect(scrollableColumns.length).toBeGreaterThanOrEqual(2);
    });

    it('should have SyncMonitorPanel in the left column (xl:flex-1)', () => {
      render(<Settings onBack={vi.fn()} />);
      const syncPanel = screen.getByTestId('sync-monitor-panel');
      const leftColumn = syncPanel.parentElement as HTMLElement;
      expect(leftColumn.className).toContain('xl:flex-1');
      expect(leftColumn.className).toContain('xl:min-w-0');
    });

    it('should have settings forms in the right column (xl:w-[480px])', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      const rightColumn = protectedPage.querySelector('.xl\\:w-\\[480px\\]');
      expect(rightColumn).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // LAYOUT-003: Settings Forms in Right Column
  // --------------------------------------------------------------------------

  describe('Settings Forms', () => {
    it('should render Save Changes button', async () => {
      render(<Settings onBack={vi.fn()} />);
      // Save button may appear after async state initialization
      const saveButton = await screen.findByRole('button', { name: /save changes/i });
      expect(saveButton).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Header Bleed (Negative Margins)
  // --------------------------------------------------------------------------

  describe('Header Bleed', () => {
    it('should have negative margins on header for edge-to-edge display', () => {
      render(<Settings onBack={vi.fn()} />);
      const protectedPage = screen.getByTestId('cloud-protected-page');
      const header = protectedPage.querySelector('header');
      expect(header).toBeTruthy();
      // Header should have negative margins to bleed into AppLayout padding
      expect(header!.className).toContain('-mx-6');
      expect(header!.className).toContain('-mt-6');
      expect(header!.className).toContain('flex-shrink-0');
    });
  });
});
