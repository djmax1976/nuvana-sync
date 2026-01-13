/**
 * Update Notification Component
 *
 * Displays update notifications with download progress and install options.
 * Follows enterprise-grade UI patterns with proper accessibility.
 *
 * @module renderer/components/UpdateNotification
 * @security SEC-004: XSS prevention via React auto-escape
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { X, Download, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

/**
 * Update status received from main process
 */
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/**
 * Update status event from IPC
 */
interface UpdateStatusEvent {
  status: UpdateStatus;
  version?: string;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  errorMessage?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Format speed to human-readable string
 */
function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

// ============================================================================
// Component
// ============================================================================

/**
 * UpdateNotification - Displays application update notifications
 *
 * Features:
 * - Update available notification with download button
 * - Download progress with speed and transfer info
 * - Update ready notification with restart button
 * - Error display with dismiss option
 * - Accessible design with ARIA attributes
 */
export function UpdateNotification(): React.ReactElement | null {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  // Subscribe to update status events
  useEffect(() => {
    const handleUpdateStatus = (event: UpdateStatusEvent): void => {
      setUpdateStatus(event);

      // Reset dismissed state when new update becomes available
      if (event.status === 'available' || event.status === 'downloaded') {
        setIsDismissed(false);
      }
    };

    // Subscribe to IPC events
    const unsubscribe = window.electronAPI.on('updater:status', (data: unknown) => {
      // SEC-014: Validate incoming data structure
      if (data && typeof data === 'object' && 'status' in data) {
        handleUpdateStatus(data as UpdateStatusEvent);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Handle download button click
  const handleDownload = useCallback(async (): Promise<void> => {
    try {
      await window.electronAPI.invoke('updater:download');
    } catch (error) {
      console.error('[UpdateNotification] Download failed:', error);
    }
  }, []);

  // Handle install/restart button click
  const handleInstall = useCallback(async (): Promise<void> => {
    try {
      await window.electronAPI.invoke('updater:install');
    } catch (error) {
      console.error('[UpdateNotification] Install failed:', error);
    }
  }, []);

  // Handle dismiss button click
  const handleDismiss = useCallback((): void => {
    setIsDismissed(true);
  }, []);

  // Don't render if no status or dismissed
  if (!updateStatus || isDismissed) {
    return null;
  }

  // Only show for certain statuses
  const visibleStatuses: UpdateStatus[] = ['available', 'downloading', 'downloaded', 'error'];
  if (!visibleStatuses.includes(updateStatus.status)) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-card p-4 shadow-lg"
    >
      {/* Update Available */}
      {updateStatus.status === 'available' && (
        <>
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" aria-hidden="true" />
              <h4 className="font-semibold text-foreground">Update Available</h4>
            </div>
            <button
              onClick={handleDismiss}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Version {updateStatus.version} is ready to download.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleDownload} size="sm" className="flex-1">
              Download Now
            </Button>
            <Button onClick={handleDismiss} variant="outline" size="sm">
              Later
            </Button>
          </div>
        </>
      )}

      {/* Downloading */}
      {updateStatus.status === 'downloading' && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <h4 className="font-semibold text-foreground">Downloading Update</h4>
          </div>
          <Progress
            value={updateStatus.percent ?? 0}
            className="mb-2"
            aria-label={`Download progress: ${(updateStatus.percent ?? 0).toFixed(0)}%`}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{(updateStatus.percent ?? 0).toFixed(1)}%</span>
            {updateStatus.bytesPerSecond !== undefined && (
              <span>{formatSpeed(updateStatus.bytesPerSecond)}</span>
            )}
          </div>
          {updateStatus.transferred !== undefined && updateStatus.total !== undefined && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatBytes(updateStatus.transferred)} / {formatBytes(updateStatus.total)}
            </p>
          )}
        </>
      )}

      {/* Downloaded / Ready to Install */}
      {updateStatus.status === 'downloaded' && (
        <>
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
              <h4 className="font-semibold text-foreground">Update Ready</h4>
            </div>
            <button
              onClick={handleDismiss}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Version {updateStatus.version} is ready. Restart to install the update.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleInstall} size="sm" className="flex-1">
              Restart Now
            </Button>
            <Button onClick={handleDismiss} variant="outline" size="sm">
              Later
            </Button>
          </div>
        </>
      )}

      {/* Error */}
      {updateStatus.status === 'error' && (
        <>
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
              <h4 className="font-semibold text-foreground">Update Error</h4>
            </div>
            <button
              onClick={handleDismiss}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {updateStatus.errorMessage ?? 'Failed to check for updates. Please try again later.'}
          </p>
          <Button onClick={handleDismiss} variant="outline" size="sm">
            Dismiss
          </Button>
        </>
      )}
    </div>
  );
}

export default UpdateNotification;
