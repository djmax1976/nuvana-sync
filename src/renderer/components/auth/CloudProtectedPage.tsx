/**
 * Cloud Protected Page Wrapper
 *
 * Wraps a page component and requires cloud email/password authentication.
 * Only allows users with SUPPORT or SUPERADMIN roles to access.
 *
 * In development mode (import.meta.env.DEV), authentication is automatically
 * bypassed with a synthetic dev user. This constant is replaced at compile time
 * by Vite — in production builds it becomes `false` and the bypass branch is
 * dead-code-eliminated by the bundler, making it physically impossible to reach.
 *
 * @module renderer/components/auth/CloudProtectedPage
 * @security SEC-001: Cloud-based role verification
 * @security OPS-012: Environment-specific config — dev bypass uses compile-time constant
 * @security FE-003: No secrets exposed — synthetic dev user contains no real credentials
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudAuthDialog, CloudAuthUser } from './CloudAuthDialog';
import { Shield, Code } from 'lucide-react';
import { Button } from '../ui/button';

// ============================================================================
// Constants
// ============================================================================

/**
 * Compile-time development mode flag.
 *
 * Vite replaces `import.meta.env.DEV` with a boolean literal at build time:
 * - Development server (npm run dev): replaced with `true`
 * - Production build (npm run build): replaced with `false`
 *
 * When `false`, the bundler's dead-code elimination removes all dev-only
 * branches entirely from the production bundle. This is NOT a runtime check
 * and cannot be toggled via environment variables at runtime.
 *
 * @security API-SEC-005: Auth bypass is compile-time only; unreachable in production builds
 */
const IS_DEV_MODE = import.meta.env.DEV;

/**
 * Synthetic user for development mode.
 * Contains no real credentials or secrets (FE-003 compliant).
 * Clearly identifiable as non-production data.
 */
const DEV_BYPASS_USER: CloudAuthUser = {
  userId: 'dev-bypass-00000000',
  email: 'dev@localhost',
  name: 'Dev Mode (Auth Bypassed)',
  roles: ['SUPPORT', 'DEV_BYPASS'],
};

// ============================================================================
// Types
// ============================================================================

export interface CloudProtectedPageProps {
  /** The protected content to render after verification - can be ReactNode or render function */
  children: React.ReactNode | ((user: CloudAuthUser) => React.ReactNode);
  /** Required roles to access this page (defaults to SUPPORT, SUPERADMIN) */
  requiredRoles?: string[];
  /** Title for the verification dialog */
  title?: string;
  /** Description for the verification dialog */
  description?: string;
  /** Callback when user is authenticated */
  onAuthenticated?: (user: CloudAuthUser) => void;
}

// ============================================================================
// Component
// ============================================================================

export function CloudProtectedPage({
  children,
  requiredRoles = ['SUPPORT', 'SUPERADMIN'],
  title = 'Support Authentication Required',
  description = 'This area is restricted to authorized support personnel only. Please log in with your support credentials.',
  onAuthenticated,
}: CloudProtectedPageProps) {
  const navigate = useNavigate();

  // In dev mode, start pre-verified with the synthetic dev user.
  // In production builds, this entire branch is dead-code-eliminated.
  const [isVerified, setIsVerified] = useState(IS_DEV_MODE);
  const [showDialog, setShowDialog] = useState(!IS_DEV_MODE);
  const [authenticatedUser, setAuthenticatedUser] = useState<CloudAuthUser | null>(
    IS_DEV_MODE ? DEV_BYPASS_USER : null
  );

  const handleAuthenticated = (user: CloudAuthUser) => {
    setIsVerified(true);
    setShowDialog(false);
    setAuthenticatedUser(user);
    onAuthenticated?.(user);
  };

  const handleClose = () => {
    setShowDialog(false);
    // Navigate back to dashboard
    navigate('/');
  };

  const handleRetry = () => {
    setShowDialog(true);
  };

  // Show verification dialog or locked state
  if (!isVerified) {
    return (
      <>
        <CloudAuthDialog
          open={showDialog}
          onClose={handleClose}
          onAuthenticated={handleAuthenticated}
          requiredRoles={requiredRoles}
          title={title}
          description={description}
        />

        {/* Show locked state when dialog is closed but not verified */}
        {!showDialog && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
            <div className="rounded-full bg-amber-500/10 p-6">
              <Shield className="h-12 w-12 text-amber-500" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold">Support Access Required</h2>
              <p className="text-muted-foreground mt-1">
                This area is restricted to authorized support personnel only.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/')}>
                Go Back
              </Button>
              <Button onClick={handleRetry}>Login</Button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Render protected content after verification
  // Support both render prop and regular children patterns
  const content =
    typeof children === 'function'
      ? authenticatedUser
        ? children(authenticatedUser)
        : null
      : children;

  // Layout: The parent <main> has p-6 padding. Child pages (e.g. Settings) use
  // negative margins (-mt-6 -mx-6) on their headers to bleed into that padding.
  // To prevent the child's negative margins from overlapping the banner, we:
  //   1. Undo the parent padding with -m-6 on our wrapper (edge-to-edge)
  //   2. Render the banner flush at the top
  //   3. Restore p-6 on the content wrapper so child negative margins work correctly
  return (
    <div className="flex flex-col h-full -m-6">
      {/* Dev mode bypass banner — visually distinct purple to prevent confusion with production */}
      {IS_DEV_MODE && authenticatedUser?.roles.includes('DEV_BYPASS') && (
        <div className="flex-shrink-0 bg-purple-500/10 border-b border-purple-500/20 px-4 py-2 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-purple-500" />
            <span className="text-purple-700 dark:text-purple-300">
              Dev Mode: Cloud authentication bypassed
            </span>
          </div>
          <span className="text-xs text-purple-600 dark:text-purple-400">DEV_BYPASS</span>
        </div>
      )}
      {/* Production authenticated user banner */}
      {authenticatedUser && !authenticatedUser.roles.includes('DEV_BYPASS') && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-500" />
            <span className="text-amber-700 dark:text-amber-300">
              Support Mode: Logged in as <strong>{authenticatedUser.name}</strong> (
              {authenticatedUser.email})
            </span>
          </div>
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {authenticatedUser.roles.join(', ')}
          </span>
        </div>
      )}
      {/* Content wrapper: restores p-6 so child negative margins bleed correctly */}
      <div className="flex-1 min-h-0 p-6">{content}</div>
    </div>
  );
}

export default CloudProtectedPage;
