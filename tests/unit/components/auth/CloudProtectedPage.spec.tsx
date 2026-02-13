/**
 * CloudProtectedPage Component Tests
 *
 * Tests the cloud authentication gate that protects privileged pages (e.g. Settings).
 * Covers both development mode (auth bypass via compile-time flag) and production
 * mode (cloud email/password auth required with role verification).
 *
 * Test Strategy:
 *   - Development mode: `import.meta.env.DEV = true` (default in Vitest).
 *     Component auto-verifies with a synthetic DEV_BYPASS user.
 *   - Production mode: `import.meta.env.DEV = false` (set before dynamic import).
 *     Component shows CloudAuthDialog and blocks content until auth succeeds.
 *   - `vi.resetModules()` + dynamic import ensures IS_DEV_MODE is re-evaluated
 *     with the correct env value for each test group.
 *
 * Traceability:
 *   - SEC-001: Cloud-based role verification for settings access
 *   - OPS-012: Environment-specific config — dev bypass uses compile-time constant
 *   - FE-003: No secrets exposed — synthetic dev user contains no real credentials
 *   - API-SEC-005: Auth bypass is compile-time only; unreachable in production builds
 *   - ARCH-004: Component-level isolation tests
 *   - TEST-005: Single concept per test
 *
 * @module tests/unit/components/auth/CloudProtectedPage
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================================================
// Hoisted Mock State
// ============================================================================

/**
 * Shared mutable state for mock callbacks captured during render.
 * vi.hoisted() ensures these are available before vi.mock() factories execute.
 */
const { capturedDialogProps, mockNavigate } = vi.hoisted(() => ({
  capturedDialogProps: { current: {} as Record<string, unknown> },
  mockNavigate: vi.fn(),
}));

// ============================================================================
// Mock Dependencies
// ============================================================================

// react-router-dom — useNavigate only (no router context needed)
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// lucide-react — replace SVG icons with testable span elements
vi.mock('lucide-react', () => ({
  Shield: (props: { className?: string }) => (
    <span data-testid="icon-shield" className={props.className} />
  ),
  Code: (props: { className?: string }) => (
    <span data-testid="icon-code" className={props.className} />
  ),
}));

// CloudAuthDialog — controllable test double that exposes captured props
vi.mock('../../../../src/renderer/components/auth/CloudAuthDialog', () => ({
  CloudAuthDialog: (props: Record<string, unknown>) => {
    capturedDialogProps.current = props;
    if (!props.open) return null;
    return (
      <div data-testid="cloud-auth-dialog">
        <span data-testid="dialog-title">{props.title as string}</span>
        <span data-testid="dialog-description">{props.description as string}</span>
      </div>
    );
  },
}));

// shadcn Button — minimal test double preserving onClick and variant
vi.mock('../../../../src/renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} data-variant={variant} {...rest}>
      {children}
    </button>
  ),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Realistic production support user fixture.
 * Matches the shape returned by `auth:cloudLogin` IPC handler.
 */
const SUPPORT_USER = {
  userId: 'usr-support-7a3b',
  email: 'jane.support@nuvanapos.com',
  name: 'Jane Support',
  roles: ['SUPPORT'],
};

/**
 * Realistic production superadmin user fixture.
 */
const SUPERADMIN_USER = {
  userId: 'usr-admin-9c2e',
  email: 'admin@nuvanapos.com',
  name: 'Admin User',
  roles: ['SUPERADMIN'],
};

/**
 * Expected synthetic dev user — must match DEV_BYPASS_USER in the component.
 * Any change to the component constant must be reflected here.
 */
const EXPECTED_DEV_USER = {
  userId: 'dev-bypass-00000000',
  email: 'dev@localhost',
  name: 'Dev Mode (Auth Bypassed)',
  roles: ['SUPPORT', 'DEV_BYPASS'],
};

/**
 * Helper: dynamically imports CloudProtectedPage after env setup.
 * Required because IS_DEV_MODE is captured at module load time.
 */
async function importComponent() {
  const mod = await import(
    '../../../../src/renderer/components/auth/CloudProtectedPage'
  );
  return mod.CloudProtectedPage;
}

// ============================================================================
// Tests
// ============================================================================

describe('CloudProtectedPage', () => {
  const originalDev = import.meta.env.DEV;

  afterEach(() => {
    vi.clearAllMocks();
    import.meta.env.DEV = originalDev;
    capturedDialogProps.current = {};
  });

  // ==========================================================================
  // Development Mode — Auth Bypass (SEC-001, OPS-012, FE-003)
  // ==========================================================================

  describe('Development Mode (IS_DEV_MODE = true)', () => {
    beforeEach(() => {
      vi.resetModules();
      import.meta.env.DEV = true;
    });

    it('CPP-DEV-001: renders protected content immediately without auth dialog', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="protected-content">Settings Panel</div>
        </CloudProtectedPage>,
      );

      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
      expect(screen.getByText('Settings Panel')).toBeInTheDocument();
      expect(screen.queryByTestId('cloud-auth-dialog')).not.toBeInTheDocument();
    });

    it('CPP-DEV-002: shows purple dev mode banner with correct text', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(
        screen.getByText('Dev Mode: Cloud authentication bypassed'),
      ).toBeInTheDocument();
    });

    it('CPP-DEV-003: dev banner displays DEV_BYPASS role indicator', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(screen.getByText('DEV_BYPASS')).toBeInTheDocument();
    });

    it('CPP-DEV-004: dev banner uses Code icon, not Shield icon', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(screen.getByTestId('icon-code')).toBeInTheDocument();
      // Shield icon should NOT appear in the dev banner
      expect(screen.queryByTestId('icon-shield')).not.toBeInTheDocument();
    });

    it('CPP-DEV-005: does NOT show production amber banner', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(screen.queryByText(/Support Mode/)).not.toBeInTheDocument();
    });

    it('CPP-DEV-006: render prop children receive the synthetic DEV_BYPASS_USER', async () => {
      const CloudProtectedPage = await importComponent();
      const renderProp = vi.fn((user: typeof EXPECTED_DEV_USER) => (
        <div data-testid="render-prop-content">
          <span data-testid="user-id">{user.userId}</span>
          <span data-testid="user-email">{user.email}</span>
          <span data-testid="user-name">{user.name}</span>
        </div>
      ));

      render(<CloudProtectedPage>{renderProp}</CloudProtectedPage>);

      expect(renderProp).toHaveBeenCalledTimes(1);
      const receivedUser = renderProp.mock.calls[0][0];
      expect(receivedUser).toEqual(EXPECTED_DEV_USER);

      // Verify the content rendered from the render prop
      expect(screen.getByTestId('user-id')).toHaveTextContent(
        'dev-bypass-00000000',
      );
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'dev@localhost',
      );
    });

    it('CPP-DEV-007: does NOT call onAuthenticated callback (no real auth occurred)', async () => {
      const CloudProtectedPage = await importComponent();
      const onAuthenticated = vi.fn();

      render(
        <CloudProtectedPage onAuthenticated={onAuthenticated}>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(onAuthenticated).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Production Mode — Auth Gate (SEC-001)
  // ==========================================================================

  describe('Production Mode (IS_DEV_MODE = false)', () => {
    beforeEach(() => {
      vi.resetModules();
      import.meta.env.DEV = false;
    });

    it('CPP-PROD-001: shows auth dialog on mount, does NOT render content', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="protected-content">Settings Panel</div>
        </CloudProtectedPage>,
      );

      expect(screen.getByTestId('cloud-auth-dialog')).toBeInTheDocument();
      expect(
        screen.queryByTestId('protected-content'),
      ).not.toBeInTheDocument();
    });

    it('CPP-PROD-002: auth dialog receives default title and description', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(screen.getByTestId('dialog-title')).toHaveTextContent(
        'Support Authentication Required',
      );
      expect(screen.getByTestId('dialog-description')).toHaveTextContent(
        'This area is restricted to authorized support personnel only.',
      );
    });

    it('CPP-PROD-003: auth dialog receives custom title and description when provided', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage
          title="Custom Title"
          description="Custom description text."
        >
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(screen.getByTestId('dialog-title')).toHaveTextContent(
        'Custom Title',
      );
      expect(screen.getByTestId('dialog-description')).toHaveTextContent(
        'Custom description text.',
      );
    });

    it('CPP-PROD-004: auth dialog receives requiredRoles prop', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage requiredRoles={['SUPERADMIN']}>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(capturedDialogProps.current.requiredRoles).toEqual([
        'SUPERADMIN',
      ]);
    });

    it('CPP-PROD-005: after successful auth, renders content and hides dialog', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="protected-content">Settings Panel</div>
        </CloudProtectedPage>,
      );

      // Verify dialog is shown, content is hidden
      expect(screen.getByTestId('cloud-auth-dialog')).toBeInTheDocument();
      expect(
        screen.queryByTestId('protected-content'),
      ).not.toBeInTheDocument();

      // Simulate successful authentication via captured callback
      const onAuthenticated = capturedDialogProps.current
        .onAuthenticated as Function;
      act(() => {
        onAuthenticated(SUPPORT_USER);
      });

      // Now content is shown, dialog is gone
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
      expect(
        screen.queryByTestId('cloud-auth-dialog'),
      ).not.toBeInTheDocument();
    });

    it('CPP-PROD-006: production banner shows authenticated user name and email', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPPORT_USER,
        );
      });

      // Verify individual elements — user name in <strong> and email in surrounding text
      expect(screen.getByText(SUPPORT_USER.name)).toBeInTheDocument();
      expect(
        screen.getByText(SUPPORT_USER.name).tagName.toLowerCase(),
      ).toBe('strong');
      expect(
        screen.getByText(/Support Mode: Logged in as/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(SUPPORT_USER.email)),
      ).toBeInTheDocument();
    });

    it('CPP-PROD-007: production banner shows user roles', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPERADMIN_USER,
        );
      });

      expect(screen.getByText('SUPERADMIN')).toBeInTheDocument();
    });

    it('CPP-PROD-008: production banner uses Shield icon, not Code icon', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPPORT_USER,
        );
      });

      expect(screen.getByTestId('icon-shield')).toBeInTheDocument();
      expect(screen.queryByTestId('icon-code')).not.toBeInTheDocument();
    });

    it('CPP-PROD-009: does NOT show dev mode purple banner after production auth', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPPORT_USER,
        );
      });

      expect(
        screen.queryByText('Dev Mode: Cloud authentication bypassed'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('DEV_BYPASS')).not.toBeInTheDocument();
    });

    it('CPP-PROD-010: closing dialog navigates to dashboard', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      // Simulate dialog close
      const onClose = capturedDialogProps.current.onClose as Function;
      act(() => {
        onClose();
      });

      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('CPP-PROD-011: locked state shows after dialog close with retry and go-back buttons', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="protected-content">Settings Panel</div>
        </CloudProtectedPage>,
      );

      // Close the dialog without authenticating
      act(() => {
        (capturedDialogProps.current.onClose as Function)();
      });

      // Should show locked state
      expect(
        screen.getByText('Support Access Required'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'This area is restricted to authorized support personnel only.',
        ),
      ).toBeInTheDocument();

      // Protected content must NOT be rendered
      expect(
        screen.queryByTestId('protected-content'),
      ).not.toBeInTheDocument();
    });

    it('CPP-PROD-012: go-back button in locked state navigates to dashboard', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      // Close dialog to show locked state
      act(() => {
        (capturedDialogProps.current.onClose as Function)();
      });
      mockNavigate.mockClear();

      // Click "Go Back" button
      const goBackBtn = screen.getByText('Go Back');
      await userEvent.click(goBackBtn);

      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('CPP-PROD-013: login button in locked state reopens auth dialog', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      // Close dialog
      act(() => {
        (capturedDialogProps.current.onClose as Function)();
      });

      // Dialog should be gone
      expect(
        screen.queryByTestId('cloud-auth-dialog'),
      ).not.toBeInTheDocument();

      // Click Login to retry
      const loginBtn = screen.getByText('Login');
      await userEvent.click(loginBtn);

      // Dialog should reappear
      expect(screen.getByTestId('cloud-auth-dialog')).toBeInTheDocument();
    });

    it('CPP-PROD-014: render prop children receive authenticated user after auth', async () => {
      const CloudProtectedPage = await importComponent();
      const renderProp = vi.fn((user: typeof SUPPORT_USER) => (
        <div data-testid="render-prop-content">
          <span data-testid="user-email">{user.email}</span>
        </div>
      ));

      render(<CloudProtectedPage>{renderProp}</CloudProtectedPage>);

      // Before auth, render prop should NOT be called
      expect(renderProp).not.toHaveBeenCalled();

      // Authenticate
      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPPORT_USER,
        );
      });

      expect(renderProp).toHaveBeenCalledTimes(1);
      expect(renderProp.mock.calls[0][0]).toEqual(SUPPORT_USER);
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'jane.support@nuvanapos.com',
      );
    });

    it('CPP-PROD-015: onAuthenticated callback fires on successful auth', async () => {
      const CloudProtectedPage = await importComponent();
      const onAuthCb = vi.fn();

      render(
        <CloudProtectedPage onAuthenticated={onAuthCb}>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPERADMIN_USER,
        );
      });

      expect(onAuthCb).toHaveBeenCalledTimes(1);
      expect(onAuthCb).toHaveBeenCalledWith(SUPERADMIN_USER);
    });

    it('CPP-PROD-016: ReactNode children (not function) render after auth', async () => {
      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="static-child">Static Content</div>
        </CloudProtectedPage>,
      );

      // Not visible before auth
      expect(screen.queryByTestId('static-child')).not.toBeInTheDocument();

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPPORT_USER,
        );
      });

      expect(screen.getByTestId('static-child')).toBeInTheDocument();
      expect(screen.getByText('Static Content')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Layout Structure (Regression)
  // ==========================================================================

  describe('Layout Structure', () => {
    beforeEach(() => {
      vi.resetModules();
      import.meta.env.DEV = true;
    });

    it('CPP-LAYOUT-001: verified state uses flex column wrapper with -m-6', async () => {
      const CloudProtectedPage = await importComponent();
      const { container } = render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain('flex');
      expect(wrapper.className).toContain('flex-col');
      expect(wrapper.className).toContain('h-full');
      expect(wrapper.className).toContain('-m-6');
    });

    it('CPP-LAYOUT-002: banner element uses flex-shrink-0 to prevent collapse', async () => {
      const CloudProtectedPage = await importComponent();
      const { container } = render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      // First child of wrapper is the banner div
      const banner = wrapper.firstElementChild as HTMLElement;
      expect(banner.className).toContain('flex-shrink-0');
    });

    it('CPP-LAYOUT-003: content wrapper has flex-1, min-h-0, and p-6 for negative margin compatibility', async () => {
      const CloudProtectedPage = await importComponent();
      const { container } = render(
        <CloudProtectedPage>
          <div data-testid="child">Content</div>
        </CloudProtectedPage>,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      // Last child of wrapper is the content wrapper div
      const contentWrapper = wrapper.lastElementChild as HTMLElement;
      expect(contentWrapper.className).toContain('flex-1');
      expect(contentWrapper.className).toContain('min-h-0');
      expect(contentWrapper.className).toContain('p-6');

      // Content should be inside this wrapper
      const child = contentWrapper.querySelector(
        '[data-testid="child"]',
      );
      expect(child).not.toBeNull();
    });
  });

  // ==========================================================================
  // Security Validation (FE-003, API-SEC-005)
  // ==========================================================================

  describe('Security', () => {
    it('CPP-SEC-001: dev bypass user contains no real credentials — synthetic IDs only', async () => {
      vi.resetModules();
      import.meta.env.DEV = true;

      const CloudProtectedPage = await importComponent();
      const receivedUser = { current: null as Record<string, unknown> | null };

      render(
        <CloudProtectedPage>
          {(user) => {
            receivedUser.current = user as unknown as Record<string, unknown>;
            return <div>Content</div>;
          }}
        </CloudProtectedPage>,
      );

      const user = receivedUser.current;
      expect(user).not.toBeNull();
      // userId is clearly synthetic (not a UUID)
      expect(user!.userId).toBe('dev-bypass-00000000');
      // Email is localhost, not a real domain
      expect(user!.email).toBe('dev@localhost');
      // Name clearly identifies as dev mode
      expect(user!.name).toContain('Dev Mode');
      // Roles include DEV_BYPASS marker
      expect(user!.roles).toContain('DEV_BYPASS');
    });

    it('CPP-SEC-002: production mode never shows dev banner, even if roles somehow contain DEV_BYPASS', async () => {
      vi.resetModules();
      import.meta.env.DEV = false;

      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      // Authenticate with a user that has DEV_BYPASS role (attack scenario)
      const hackedUser = {
        userId: 'hacker-001',
        email: 'attacker@evil.com',
        name: 'Attacker',
        roles: ['SUPPORT', 'DEV_BYPASS'],
      };

      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(hackedUser);
      });

      // IS_DEV_MODE is false, so the dev banner condition fails regardless of roles
      expect(
        screen.queryByText('Dev Mode: Cloud authentication bypassed'),
      ).not.toBeInTheDocument();
    });

    it('CPP-SEC-003: production mode requires explicit auth — starts unverified', async () => {
      vi.resetModules();
      import.meta.env.DEV = false;

      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="secret-content">Secret Data</div>
        </CloudProtectedPage>,
      );

      // Content MUST NOT be in the DOM before authentication
      expect(
        screen.queryByTestId('secret-content'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Secret Data')).not.toBeInTheDocument();

      // Auth dialog MUST be shown
      expect(screen.getByTestId('cloud-auth-dialog')).toBeInTheDocument();
    });

    it('CPP-SEC-004: locked state does not expose protected content in DOM', async () => {
      vi.resetModules();
      import.meta.env.DEV = false;

      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="secret-content">Confidential Settings</div>
        </CloudProtectedPage>,
      );

      // Close dialog to enter locked state
      act(() => {
        (capturedDialogProps.current.onClose as Function)();
      });

      // Content must be completely absent from DOM, not just hidden via CSS
      expect(
        screen.queryByTestId('secret-content'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Confidential Settings'),
      ).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('CPP-EDGE-001: default requiredRoles is SUPPORT and SUPERADMIN', async () => {
      vi.resetModules();
      import.meta.env.DEV = false;

      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(capturedDialogProps.current.requiredRoles).toEqual([
        'SUPPORT',
        'SUPERADMIN',
      ]);
    });

    it('CPP-EDGE-002: custom requiredRoles override the defaults', async () => {
      vi.resetModules();
      import.meta.env.DEV = false;

      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage requiredRoles={['ADMIN', 'OWNER']}>
          <div>Content</div>
        </CloudProtectedPage>,
      );

      expect(capturedDialogProps.current.requiredRoles).toEqual([
        'ADMIN',
        'OWNER',
      ]);
    });

    it('CPP-EDGE-003: multiple auth cycles work — close, retry, authenticate', async () => {
      vi.resetModules();
      import.meta.env.DEV = false;

      const CloudProtectedPage = await importComponent();
      render(
        <CloudProtectedPage>
          <div data-testid="protected-content">Settings</div>
        </CloudProtectedPage>,
      );

      // 1. Close dialog → locked state
      act(() => {
        (capturedDialogProps.current.onClose as Function)();
      });
      expect(screen.getByText('Support Access Required')).toBeInTheDocument();

      // 2. Click Login to retry
      await userEvent.click(screen.getByText('Login'));
      expect(screen.getByTestId('cloud-auth-dialog')).toBeInTheDocument();

      // 3. Successfully authenticate
      act(() => {
        (capturedDialogProps.current.onAuthenticated as Function)(
          SUPPORT_USER,
        );
      });
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
      expect(
        screen.queryByTestId('cloud-auth-dialog'),
      ).not.toBeInTheDocument();
    });
  });
});
