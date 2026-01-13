
/**
 * Manual Entry Mode Indicator Component
 *
 * Story: 10.4 - Manual Entry Override
 *
 * Displays a visual indicator when manual entry mode is active.
 * Shows authorized user name and timestamp.
 *
 * @requirements
 * - AC #4: Visual indicator shows "Manual Entry Mode Active"
 * - Display authorized user name and timestamp
 * - Style with yellow/amber color (warning)
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

/**
 * Props for ManualEntryIndicator component
 */
export interface ManualEntryIndicatorProps {
  /** Whether manual entry mode is active */
  isActive: boolean;
  /** Authorized user information */
  authorizedBy: {
    userId: string;
    name: string;
  } | null;
  /** Timestamp when manual entry was authorized */
  authorizedAt: Date | null;
}

/**
 * ManualEntryIndicator component
 * Displays visual indicator when manual entry mode is active
 */
export function ManualEntryIndicator({
  isActive,
  authorizedBy,
  authorizedAt,
}: ManualEntryIndicatorProps) {
  // Don't render if not active
  if (!isActive || !authorizedBy || !authorizedAt) {
    return null;
  }

  // Format timestamp for display
  const formattedTime = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(authorizedAt);

  return (
    <Alert
      className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20"
      data-testid="manual-entry-indicator"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      <AlertTitle className="text-amber-900 dark:text-amber-100">
        Manual Entry Mode Active
      </AlertTitle>
      <AlertDescription className="mt-2 text-amber-800 dark:text-amber-200">
        <div className="space-y-1 text-sm">
          <div>
            Authorized by:{" "}
            <span className="font-medium">{authorizedBy.name}</span>
          </div>
          <div>
            Authorized at: <span className="font-medium">{formattedTime}</span>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
