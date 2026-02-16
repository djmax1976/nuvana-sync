/**
 * Reset Store Dialog
 *
 * A dialog that allows authorized support/admin users to reset store data.
 * Requires typing "RESET" to confirm and cloud authorization for audit logging.
 *
 * In dev mode, the Settings page bypasses cloud auth with a synthetic user.
 * However, store reset ALWAYS requires real cloud credentials because:
 * 1. The cloud API must authorize and audit-log the reset
 * 2. Lottery configuration requires valid cloud credentials
 *
 * @module renderer/components/settings/ResetStoreDialog
 * @security SEC-017: Full audit trail via cloud API
 * @security API-004: Cloud-based role verification (SUPPORT/SUPERADMIN only)
 * @security SEC-018: Dev bypass users must re-authenticate for destructive operations
 */

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { AlertTriangle, Loader2, RotateCcw, Database, Settings, RefreshCw } from 'lucide-react';
import { CloudAuthDialog, type CloudAuthUser } from '../auth/CloudAuthDialog';

// ============================================================================
// Types
// ============================================================================

export type ResetType = 'FULL_RESET' | 'LOTTERY_ONLY' | 'SYNC_STATE';

export interface ResetStoreDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Cloud authenticated user performing the reset */
  cloudAuthUser: CloudAuthUser;
  /** Callback after successful reset - app should restart */
  onResetComplete: (auditReferenceId: string) => void;
}

interface ResetResponse {
  success: boolean;
  auditReferenceId?: string;
  tablesCleared?: number;
  clearedTables?: string[];
  failedTables?: string[];
  settingsDeleted?: boolean;
  resyncRequired?: boolean;
  serverTime?: string;
  error?: string;
  message?: string;
}

interface ResetOption {
  value: ResetType;
  label: string;
  description: string;
  icon: React.ReactNode;
  severity: 'high' | 'medium' | 'low';
}

// ============================================================================
// Constants
// ============================================================================

const RESET_OPTIONS: ResetOption[] = [
  {
    value: 'FULL_RESET',
    label: 'Full Reset',
    description:
      'Clears ALL local data: lottery, transactions, sync state, and settings. Complete fresh start.',
    icon: <Database className="h-5 w-5" />,
    severity: 'high',
  },
  {
    value: 'LOTTERY_ONLY',
    label: 'Lottery Only',
    description:
      'Clears lottery packs, shifts, activations, and settlements. Keeps transactions and settings.',
    icon: <RotateCcw className="h-5 w-5" />,
    severity: 'medium',
  },
  {
    value: 'SYNC_STATE',
    label: 'Sync State Only',
    description:
      'Clears sync queue and forces a full re-sync. Use this to fix sync issues without losing data.',
    icon: <RefreshCw className="h-5 w-5" />,
    severity: 'low',
  },
];

const CONFIRMATION_WORD = 'RESET';

/** Roles that indicate a dev bypass user needing re-authentication */
const DEV_BYPASS_ROLES = ['DEV_BYPASS'];

/** Required roles for store reset */
const REQUIRED_RESET_ROLES = ['SUPPORT', 'SUPERADMIN'];

// ============================================================================
// Component
// ============================================================================

export function ResetStoreDialog({
  open,
  onClose,
  cloudAuthUser,
  onResetComplete,
}: ResetStoreDialogProps) {
  // SEC-014: No pre-selection - user must explicitly choose a reset type
  const [selectedType, setSelectedType] = useState<ResetType | null>(null);
  const [deleteSettings, setDeleteSettings] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  // SEC-018: Dev bypass users must re-authenticate with real credentials
  const isDevBypassUser = cloudAuthUser.roles.some((r) => DEV_BYPASS_ROLES.includes(r));
  const [showReAuthDialog, setShowReAuthDialog] = useState(false);
  const [verifiedCloudUser, setVerifiedCloudUser] = useState<CloudAuthUser | null>(null);

  // The effective user for the reset operation (verified user or original if not dev bypass)
  const effectiveUser = verifiedCloudUser || (isDevBypassUser ? null : cloudAuthUser);

  // Reset state when dialog opens - SEC-014: No pre-selection for security-critical actions
  useEffect(() => {
    if (open) {
      setSelectedType(null); // User must explicitly select a reset type
      setDeleteSettings(false);
      setReason('');
      setConfirmationText('');
      setError(null);
      setIsResetting(false);
      setHasAttemptedSubmit(false);
      // Reset verified user when dialog opens
      setVerifiedCloudUser(null);
      // Show re-auth dialog immediately for dev bypass users
      if (isDevBypassUser) {
        setShowReAuthDialog(true);
      }
    }
  }, [open, isDevBypassUser]);

  // Auto-check delete settings for FULL_RESET (only when explicitly selected)
  useEffect(() => {
    if (selectedType === 'FULL_RESET') {
      setDeleteSettings(true);
    } else if (selectedType !== null) {
      // Only reset deleteSettings if user explicitly chose a non-FULL_RESET option
      // Don't reset on null to preserve user preference during form edits
    }
  }, [selectedType]);

  const isConfirmationValid = confirmationText.toUpperCase() === CONFIRMATION_WORD;
  const isReasonValid = reason.trim().length > 0;
  const isResetTypeSelected = selectedType !== null;

  const handleReAuthSuccess = (user: CloudAuthUser) => {
    setVerifiedCloudUser(user);
    setShowReAuthDialog(false);
    setError(null);
  };

  const handleReAuthClose = () => {
    setShowReAuthDialog(false);
    // If user cancels re-auth and is a dev bypass user, close the reset dialog
    if (isDevBypassUser && !verifiedCloudUser) {
      onClose();
    }
  };

  const handleReset = async () => {
    setHasAttemptedSubmit(true);

    // SEC-018: Require verified credentials for dev bypass users
    if (!effectiveUser) {
      setError('Please authenticate with real cloud credentials to proceed');
      setShowReAuthDialog(true);
      return;
    }

    // SEC-014: Validate mandatory reset type selection
    if (!isResetTypeSelected) {
      setError('Please select a reset type before proceeding');
      return;
    }

    if (!isReasonValid) {
      setError('Please provide a reason for the reset');
      return;
    }

    if (!isConfirmationValid) {
      setError(`Please type "${CONFIRMATION_WORD}" to confirm`);
      confirmInputRef.current?.focus();
      return;
    }

    setIsResetting(true);
    setError(null);

    try {
      // Build request payload with mandatory reason
      // selectedType is guaranteed to be non-null by the validation above
      const resetType = selectedType as ResetType;
      const requestPayload = {
        resetType,
        deleteSettings: resetType === 'FULL_RESET' ? true : deleteSettings,
        cloudAuth: {
          email: effectiveUser.email,
          userId: effectiveUser.userId,
          roles: effectiveUser.roles,
        },
        reason: reason.trim(),
      };

      const response = await window.electronAPI.invoke<ResetResponse>(
        'settings:resetStore',
        requestPayload
      );

      if (!response.success) {
        setError(response.error || response.message || 'Reset failed');
        return;
      }

      // Success - notify parent to handle restart
      onResetComplete(response.auditReferenceId || 'reset-completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setIsResetting(false);
    }
  };

  const getSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high':
        return 'border-red-500 bg-red-500/5';
      case 'medium':
        return 'border-amber-500 bg-amber-500/5';
      case 'low':
        return 'border-blue-500 bg-blue-500/5';
    }
  };

  const getSelectedSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high':
        return 'border-red-500 bg-red-500/10 ring-2 ring-red-500/20';
      case 'medium':
        return 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/20';
      case 'low':
        return 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/20';
    }
  };

  return (
    <>
      {/* SEC-018: Re-authentication dialog for dev bypass users */}
      <CloudAuthDialog
        open={showReAuthDialog}
        onClose={handleReAuthClose}
        onAuthenticated={handleReAuthSuccess}
        requiredRoles={REQUIRED_RESET_ROLES}
        title="Cloud Authentication Required"
        description="Store reset requires real cloud credentials for audit logging and authorization. Please log in with your support account."
      />

      <Dialog
        open={open && !showReAuthDialog}
        onOpenChange={(isOpen) => !isOpen && !isResetting && onClose()}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Reset Store Data
            </DialogTitle>
            <DialogDescription>
              This action will permanently delete local data. The reset will be recorded in the
              audit log for compliance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Reset Type Selection - Mandatory */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Select reset type <span className="text-destructive">*</span>:
              </label>
              {/* Show validation error when user attempts submit without selection */}
              {hasAttemptedSubmit && !isResetTypeSelected && (
                <p className="text-xs text-destructive">You must select a reset type to continue</p>
              )}
              <div
                className={`space-y-2 ${hasAttemptedSubmit && !isResetTypeSelected ? 'ring-2 ring-destructive/50 rounded-lg p-2' : ''}`}
              >
                {RESET_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    htmlFor={`reset-type-${option.value}`}
                    className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedType === option.value
                        ? getSelectedSeverityColor(option.severity)
                        : `${getSeverityColor(option.severity)} hover:bg-accent/50`
                    } ${isResetting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {/* Checkbox input - mandatory selection */}
                    <input
                      type="checkbox"
                      id={`reset-type-${option.value}`}
                      name="reset-type"
                      checked={selectedType === option.value}
                      onChange={() => setSelectedType(option.value)}
                      disabled={isResetting}
                      className={`mt-1 h-5 w-5 rounded border-2 focus:ring-2 focus:ring-offset-1 ${
                        option.severity === 'high'
                          ? 'text-red-500 border-red-400 focus:ring-red-500'
                          : option.severity === 'medium'
                            ? 'text-amber-500 border-amber-400 focus:ring-amber-500'
                            : 'text-blue-500 border-blue-400 focus:ring-blue-500'
                      }`}
                      aria-required="true"
                    />
                    <div
                      className={`mt-0.5 ${
                        option.severity === 'high'
                          ? 'text-red-500'
                          : option.severity === 'medium'
                            ? 'text-amber-500'
                            : 'text-blue-500'
                      }`}
                    >
                      {option.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{option.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Delete Settings Checkbox - only show when a non-FULL_RESET type is selected */}
            {selectedType !== null && selectedType !== 'FULL_RESET' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="delete-settings"
                  checked={deleteSettings}
                  onChange={(e) => setDeleteSettings(e.target.checked)}
                  disabled={isResetting}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="delete-settings" className="text-sm flex items-center gap-1.5">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Also delete app settings (nuvana.json)
                </label>
              </div>
            )}

            {/* Reason Input */}
            <div className="space-y-2">
              <label htmlFor="reset-reason" className="text-sm font-medium">
                Reason <span className="text-destructive">*</span>:
              </label>
              <Input
                id="reset-reason"
                placeholder="e.g., Store ownership transfer, Testing, Data corruption..."
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                disabled={isResetting}
                maxLength={500}
                className={reason === '' ? '' : !isReasonValid ? 'border-destructive' : ''}
              />
            </div>

            {/* Confirmation Input */}
            <div className="space-y-2">
              <label htmlFor="reset-confirmation" className="text-sm font-medium">
                Type <span className="font-mono text-destructive">{CONFIRMATION_WORD}</span> to
                confirm:
              </label>
              <Input
                ref={confirmInputRef}
                id="reset-confirmation"
                placeholder={CONFIRMATION_WORD}
                value={confirmationText}
                onChange={(e) => {
                  setConfirmationText(e.target.value);
                  setError(null);
                }}
                disabled={isResetting}
                className={`font-mono uppercase ${
                  confirmationText && !isConfirmationValid ? 'border-destructive' : ''
                }`}
              />
            </div>

            {/* Error Display */}
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Performing User Info */}
            {effectiveUser ? (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span>
                  Performing as: {effectiveUser.email} ({effectiveUser.roles.join(', ')})
                </span>
                {isDevBypassUser && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setShowReAuthDialog(true)}
                  >
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-center">
                <p className="text-xs text-amber-600">Cloud authentication required to proceed</p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setShowReAuthDialog(true)}
                >
                  Authenticate now
                </Button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isResetting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleReset}
                disabled={
                  isResetting ||
                  !effectiveUser ||
                  !isResetTypeSelected ||
                  !isConfirmationValid ||
                  !isReasonValid
                }
              >
                {isResetting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Reset Store
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ResetStoreDialog;
