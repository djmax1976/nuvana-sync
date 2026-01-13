/**
 * LicenseWarning Component
 *
 * Dismissible warning banner shown when subscription expires within 30 days.
 * Positioned at the top of the app, above main content.
 *
 * @module renderer/components/license/LicenseWarning
 */

import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../ui/button';

interface LicenseWarningProps {
  /** Days remaining until expiry (can be negative if in grace period) */
  daysRemaining: number;
  /** Whether currently in grace period */
  inGracePeriod?: boolean;
}

/**
 * Get warning message based on days remaining
 */
function getWarningMessage(daysRemaining: number, inGracePeriod: boolean): string {
  if (inGracePeriod) {
    const daysOverdue = Math.abs(daysRemaining);
    if (daysOverdue === 1) {
      return 'Your subscription expired 1 day ago. Renew now to avoid service interruption.';
    }
    return `Your subscription expired ${daysOverdue} days ago. Renew now to avoid service interruption.`;
  }

  if (daysRemaining <= 0) {
    return 'Your subscription has expired. Please renew immediately.';
  }

  if (daysRemaining === 1) {
    return 'Your subscription expires tomorrow. Renew now to avoid service interruption.';
  }

  if (daysRemaining <= 7) {
    return `Your subscription expires in ${daysRemaining} days. Renew soon.`;
  }

  return `Your subscription expires in ${daysRemaining} days.`;
}

/**
 * Get urgency level for styling
 */
function getUrgencyLevel(daysRemaining: number, inGracePeriod: boolean): 'low' | 'medium' | 'high' {
  if (inGracePeriod || daysRemaining <= 0) {
    return 'high';
  }
  if (daysRemaining <= 7) {
    return 'medium';
  }
  return 'low';
}

/**
 * LicenseWarning Component
 *
 * Renders a dismissible warning banner for expiring/expired subscriptions.
 * The banner is session-only dismissible (reappears on next session).
 */
export function LicenseWarning({
  daysRemaining,
  inGracePeriod = false,
}: LicenseWarningProps): React.ReactElement | null {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) {
    return null;
  }

  const urgency = getUrgencyLevel(daysRemaining, inGracePeriod);
  const message = getWarningMessage(daysRemaining, inGracePeriod);

  // Style classes based on urgency
  const containerClasses = {
    low: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
    medium: 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800',
    high: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
  };

  const iconClasses = {
    low: 'text-amber-600 dark:text-amber-400',
    medium: 'text-orange-600 dark:text-orange-400',
    high: 'text-red-600 dark:text-red-400',
  };

  const textClasses = {
    low: 'text-amber-800 dark:text-amber-200',
    medium: 'text-orange-800 dark:text-orange-200',
    high: 'text-red-800 dark:text-red-200',
  };

  return (
    <div
      className={`flex items-center justify-between border-b px-4 py-2 ${containerClasses[urgency]}`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${iconClasses[urgency]}`} />
        <span className={`text-sm font-medium ${textClasses[urgency]}`}>
          {message}
        </span>
        <a
          href="mailto:support@nuvana.com"
          className={`text-sm font-medium underline hover:no-underline ${textClasses[urgency]}`}
        >
          Renew now
        </a>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 ${textClasses[urgency]} hover:bg-transparent`}
        onClick={() => setIsDismissed(true)}
        aria-label="Dismiss warning"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default LicenseWarning;
