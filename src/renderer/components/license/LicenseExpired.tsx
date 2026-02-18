/**
 * LicenseExpired Component
 *
 * Full-screen lock screen displayed when the subscription has expired
 * beyond the grace period. Blocks all app functionality until renewed.
 *
 * @module renderer/components/license/LicenseExpired
 * @security Blocks all app access when license is invalid
 */

import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { AlertCircle, RefreshCw, Mail, Phone } from 'lucide-react';

interface LicenseExpiredProps {
  /** Expiry date in ISO format */
  expiresAt: string | null;
  /** Callback when retry succeeds and license is valid */
  onRetrySuccess: () => void;
}

/**
 * Format date for display
 */
function formatExpiryDate(isoDate: string | null): string {
  if (!isoDate) {
    return 'Unknown';
  }

  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return 'Unknown';
  }
}

/**
 * LicenseExpired Component
 *
 * Renders a full-screen lock screen when the license has expired.
 * Provides contact information and a retry button for checking license status.
 */
export function LicenseExpired({
  expiresAt,
  onRetrySuccess,
}: LicenseExpiredProps): React.ReactElement {
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckAgain = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      // Call the IPC to force a license check
      const result = await window.electronAPI.invoke<{
        data?: { valid: boolean };
        error?: string;
      }>('license:checkNow');

      if (result.data?.valid) {
        onRetrySuccess();
      } else {
        setError('Subscription is still expired. Please renew to continue using Nuvana.');
      }
    } catch (_err) {
      setError('Unable to check license status. Please check your internet connection.');
    } finally {
      setIsChecking(false);
    }
  }, [onRetrySuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-md px-6 py-8 text-center">
        {/* Logo placeholder */}
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-10 w-10 text-destructive" />
        </div>

        {/* Title */}
        <h1 className="mb-2 text-2xl font-bold text-foreground">Subscription Expired</h1>

        {/* Message */}
        <p className="mb-6 text-muted-foreground">
          Your subscription ended on{' '}
          <span className="font-medium text-foreground">{formatExpiryDate(expiresAt)}</span>. Please
          renew to continue using Nuvana.
        </p>

        {/* Error message */}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Contact information */}
        <div className="mb-8 rounded-lg border bg-muted/50 p-4">
          <h2 className="mb-3 text-sm font-medium text-foreground">Contact Support</h2>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center justify-center gap-2">
              <Mail className="h-4 w-4" />
              <a href="mailto:support@nuvana.com" className="text-primary hover:underline">
                support@nuvana.com
              </a>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Phone className="h-4 w-4" />
              <span>1-800-NUVANA-1</span>
            </div>
          </div>
        </div>

        {/* Retry button */}
        <Button onClick={handleCheckAgain} disabled={isChecking} className="w-full" size="lg">
          {isChecking ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Check Again
            </>
          )}
        </Button>

        {/* Footer */}
        <p className="mt-6 text-xs text-muted-foreground">
          If you've recently renewed your subscription, click "Check Again" to refresh your license
          status.
        </p>
      </div>
    </div>
  );
}

export default LicenseExpired;
