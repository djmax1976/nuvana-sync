/**
 * Reset Store Dialog
 *
 * A dialog that allows authorized support/admin users to reset store data.
 * Requires typing "RESET" to confirm and cloud authorization for audit logging.
 *
 * @module renderer/components/settings/ResetStoreDialog
 * @security SEC-017: Full audit trail via cloud API
 * @security API-004: Cloud-based role verification (SUPPORT/SUPERADMIN only)
 */

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { AlertTriangle, Loader2, RotateCcw, Database, Settings, RefreshCw } from 'lucide-react';
import type { CloudAuthUser } from '../auth/CloudAuthDialog';

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

// ============================================================================
// Component
// ============================================================================

export function ResetStoreDialog({
  open,
  onClose,
  cloudAuthUser,
  onResetComplete,
}: ResetStoreDialogProps) {
  const [selectedType, setSelectedType] = useState<ResetType>('SYNC_STATE');
  const [deleteSettings, setDeleteSettings] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedType('SYNC_STATE');
      setDeleteSettings(false);
      setReason('');
      setConfirmationText('');
      setError(null);
      setIsResetting(false);
    }
  }, [open]);

  // Auto-check delete settings for FULL_RESET
  useEffect(() => {
    if (selectedType === 'FULL_RESET') {
      setDeleteSettings(true);
    }
  }, [selectedType]);

  const isConfirmationValid = confirmationText.toUpperCase() === CONFIRMATION_WORD;
  const isReasonValid = reason.trim().length > 0;

  const handleReset = async () => {
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
      const requestPayload = {
        resetType: selectedType,
        deleteSettings: selectedType === 'FULL_RESET' ? true : deleteSettings,
        cloudAuth: {
          email: cloudAuthUser.email,
          userId: cloudAuthUser.userId,
          roles: cloudAuthUser.roles,
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !isResetting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Reset Store Data
          </DialogTitle>
          <DialogDescription>
            This action will permanently delete local data. The reset will be recorded in the audit
            log for compliance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Reset Type Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select reset type:</label>
            <div className="space-y-2">
              {RESET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedType(option.value)}
                  disabled={isResetting}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                    selectedType === option.value
                      ? getSelectedSeverityColor(option.severity)
                      : `${getSeverityColor(option.severity)} hover:bg-accent/50`
                  } ${isResetting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="flex items-start gap-3">
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
                        {selectedType === option.value && (
                          <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Delete Settings Checkbox - only show for non-FULL_RESET */}
          {selectedType !== 'FULL_RESET' && (
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
          <p className="text-xs text-muted-foreground text-center">
            Performing as: {cloudAuthUser.email} ({cloudAuthUser.roles.join(', ')})
          </p>

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isResetting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReset}
              disabled={isResetting || !isConfirmationValid || !isReasonValid}
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
  );
}

export default ResetStoreDialog;
