/**
 * Cloud Protected Page Wrapper
 *
 * Wraps a page component and requires cloud email/password authentication.
 * Only allows users with SUPPORT or SUPERADMIN roles to access.
 *
 * @module renderer/components/auth/CloudProtectedPage
 * @security SEC-001: Cloud-based role verification
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudAuthDialog, CloudAuthUser } from './CloudAuthDialog';
import { Shield } from 'lucide-react';
import { Button } from '../ui/button';

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
  // Start with dialog open and not verified
  const [isVerified, setIsVerified] = useState(false);
  const [showDialog, setShowDialog] = useState(true);
  const [authenticatedUser, setAuthenticatedUser] = useState<CloudAuthUser | null>(null);

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
    typeof children === 'function' && authenticatedUser ? children(authenticatedUser) : children;

  return (
    <>
      {/* Show authenticated user banner */}
      {authenticatedUser && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm flex items-center justify-between">
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
      {content}
    </>
  );
}

export default CloudProtectedPage;
