/**
 * Protected Page Wrapper
 *
 * Wraps a page component and requires PIN verification before showing content.
 * Automatically prompts for PIN when the page is accessed.
 *
 * @module renderer/components/auth/ProtectedPage
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinVerificationDialog } from './PinVerificationDialog';
import { Lock } from 'lucide-react';
import { Button } from '../ui/button';

// ============================================================================
// Types
// ============================================================================

export interface ProtectedPageProps {
  /** The protected content to render after verification */
  children: React.ReactNode;
  /** Minimum role required to access this page */
  requiredRole?: 'cashier' | 'shift_manager' | 'store_manager';
  /** Title for the verification dialog */
  title?: string;
  /** Description for the verification dialog */
  description?: string;
}

// ============================================================================
// Component
// ============================================================================

export function ProtectedPage({
  children,
  requiredRole = 'store_manager',
  title,
  description,
}: ProtectedPageProps) {
  const navigate = useNavigate();
  // Initialize state with correct initial values - no need for useEffect to reset
  const [isVerified, setIsVerified] = useState(false);
  const [showDialog, setShowDialog] = useState(true);

  const handleVerified = useCallback(() => {
    setIsVerified(true);
    setShowDialog(false);
  }, []);

  const handleClose = useCallback(() => {
    setShowDialog(false);
    // Navigate back to dashboard
    navigate('/');
  }, [navigate]);

  const handleRetry = useCallback(() => {
    setShowDialog(true);
  }, []);

  // Show verification dialog or locked state
  if (!isVerified) {
    return (
      <>
        <PinVerificationDialog
          open={showDialog}
          onClose={handleClose}
          onVerified={handleVerified}
          requiredRole={requiredRole}
          title={title}
          description={description}
        />

        {/* Show locked state when dialog is closed but not verified */}
        {!showDialog && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
            <div className="rounded-full bg-muted p-6">
              <Lock className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold">Authentication Required</h2>
              <p className="text-muted-foreground mt-1">
                You need to verify your PIN to access this page.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/')}>
                Go Back
              </Button>
              <Button onClick={handleRetry}>Enter PIN</Button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Render protected content after verification
  return <>{children}</>;
}

export default ProtectedPage;
