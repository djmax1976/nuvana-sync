/**
 * Lottery Authentication Modal Component
 * Two-tab authentication flow for pack activation:
 * 1. Cashier Tab: PIN-only input with automatic shift detection
 * 2. Management Tab: Email/password login for managers (no shift required)
 *
 * Story: Pack Activation UX Enhancement
 *
 * @requirements
 * - Cashier tab: PIN-only input, auto-detects active shift from PIN
 * - Management tab: Email/password for manager authentication
 * - Managers bypass active shift requirement
 * - Error handling for invalid credentials
 * - Returns cashier/user info and shift_id on success
 * - Audit trail: Records who authenticated for compliance
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Mirror backend validation client-side
 * - SEC-014: INPUT_VALIDATION - Strict schemas with format constraints
 * - SEC-004: XSS - React auto-escapes output
 * - API-004: AUTHENTICATION - Secure authentication flow
 * - SEC-001: PASSWORD_HASHING - PIN/password verified server-side via bcrypt
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, User, Shield } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import apiClient, { ApiResponse, extractData } from '@/lib/api/client';

/**
 * Result of successful authentication
 */
export interface LotteryAuthResult {
  cashier_id: string;
  cashier_name: string;
  shift_id: string;
  auth_type: 'cashier' | 'management';
  /** Permissions of the authenticated user (only for management auth) */
  permissions?: string[];
}

/**
 * Result of serial override manager approval (separate from activation auth)
 */
export interface SerialOverrideApproval {
  approver_id: string;
  approver_name: string;
  approved_at: Date;
  has_permission: boolean;
}

/**
 * Result of mark sold manager approval (separate from activation auth)
 * Used when cashier needs manager approval to mark pack as pre-sold during activation
 */
export interface MarkSoldApproval {
  approver_id: string;
  approver_name: string;
  approved_at: Date;
  has_permission: boolean;
}

interface LotteryAuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  onAuthenticated: (result: LotteryAuthResult) => void;
  /** Mode for the modal - "activation" requires shift, "serial_override" and "mark_sold" are manager-only */
  mode?: 'activation' | 'serial_override' | 'mark_sold';
  /** Callback for serial override approval (only used in serial_override mode) */
  onSerialOverrideApproved?: (approval: SerialOverrideApproval) => void;
  /** Callback for mark sold approval (only used in mark_sold mode) */
  onMarkSoldApproved?: (approval: MarkSoldApproval) => void;
}

/**
 * Authenticate cashier by PIN only (auto-detects active shift)
 * Uses new /authenticate-pin endpoint
 */
async function authenticateCashierByPin(
  storeId: string,
  pin: string
): Promise<{ cashier_id: string; cashier_name: string; shift_id: string }> {
  const response = await apiClient.post<
    ApiResponse<{ cashier_id: string; cashier_name: string; shift_id: string }>
  >(`/api/stores/${storeId}/cashiers/authenticate-pin`, { pin });
  return extractData(response);
}

/**
 * Authenticate manager with email/password
 * Uses verify-management endpoint which:
 * - Does NOT set cookies (won't log out current user)
 * - Validates manager role on backend
 * - Returns user info and permissions for audit
 */
async function authenticateManager(
  email: string,
  password: string
): Promise<{
  user_id: string;
  name: string;
  email: string;
  permissions: string[];
}> {
  const response = await apiClient.post<
    ApiResponse<{
      user_id: string;
      name: string;
      email: string;
      roles: string[];
      permissions: string[];
    }>
  >('/api/auth/verify-management', { email, password });

  const data = extractData(response);

  return {
    user_id: data.user_id,
    name: data.name,
    email: data.email,
    permissions: data.permissions || [],
  };
}

/**
 * LotteryAuthModal component
 * Tabbed authentication for lottery pack activation
 */
export function LotteryAuthModal({
  open,
  onOpenChange,
  storeId,
  onAuthenticated,
  mode = 'activation',
  onSerialOverrideApproved,
  onMarkSoldApproved,
}: LotteryAuthModalProps) {
  // In serial_override or mark_sold mode, only show management tab
  const isSerialOverrideMode = mode === 'serial_override';
  const isMarkSoldMode = mode === 'mark_sold';
  const isManagerOnlyMode = isSerialOverrideMode || isMarkSoldMode;
  // Tab state
  const [activeTab, setActiveTab] = useState<'cashier' | 'management'>('cashier');

  // Cashier tab state
  const [pin, setPin] = useState('');
  const [cashierError, setCashierError] = useState<string | null>(null);

  // Management tab state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [managementError, setManagementError] = useState<string | null>(null);

  // Refs for autofocus
  const pinInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Cashier PIN authentication mutation
  const cashierAuthMutation = useMutation({
    mutationFn: async () => {
      return await authenticateCashierByPin(storeId, pin);
    },
  });

  // Management authentication mutation
  const managementAuthMutation = useMutation({
    mutationFn: async () => {
      return await authenticateManager(email, password);
    },
  });

  const isSubmitting = cashierAuthMutation.isPending || managementAuthMutation.isPending;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      // In manager-only modes (serial_override, mark_sold), always start on management tab
      setActiveTab(isManagerOnlyMode ? 'management' : 'cashier');
      setPin('');
      setCashierError(null);
      setEmail('');
      setPassword('');
      setManagementError(null);
      cashierAuthMutation.reset();
      managementAuthMutation.reset();

      // Focus the appropriate input after dialog animation completes
      const timer = setTimeout(() => {
        if (isManagerOnlyMode) {
          emailInputRef.current?.focus();
        } else {
          pinInputRef.current?.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isManagerOnlyMode]);

  // Focus appropriate input when tab changes
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (activeTab === 'cashier') {
          pinInputRef.current?.focus();
        } else {
          emailInputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeTab, open]);

  // Handle cashier PIN submission
  const handleCashierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCashierError(null);

    // SEC-014: INPUT_VALIDATION - Validate PIN format
    if (!pin || !/^\d{4}$/.test(pin)) {
      setCashierError('PIN must be exactly 4 digits');
      return;
    }

    try {
      const result = await cashierAuthMutation.mutateAsync();
      onAuthenticated({
        cashier_id: result.cashier_id,
        cashier_name: result.cashier_name,
        shift_id: result.shift_id,
        auth_type: 'cashier',
      });
      onOpenChange(false);
    } catch (err) {
      // Check for ApiError with code property first
      const errorCode = (err as { code?: string })?.code;
      const errorMessage = err instanceof Error ? err.message : '';
      const errorMsgLower = errorMessage.toLowerCase();

      if (
        errorCode === 'NO_ACTIVE_SHIFT' ||
        errorMsgLower.includes('must have an open or active shift') ||
        errorMsgLower.includes('must have an active shift')
      ) {
        setCashierError('You must have an active shift to activate packs.');
      } else if (errorCode === 'AUTHENTICATION_FAILED' || errorMsgLower.includes('invalid pin')) {
        setCashierError('Invalid PIN. Please try again.');
      } else {
        setCashierError('Authentication failed. Please try again.');
      }
    }
  };

  // Handle management login submission
  const handleManagementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManagementError(null);

    // SEC-014: INPUT_VALIDATION - Basic validation
    if (!email || !email.includes('@')) {
      setManagementError('Please enter a valid email address');
      return;
    }

    if (!password || password.length < 1) {
      setManagementError('Password is required');
      return;
    }

    try {
      const result = await managementAuthMutation.mutateAsync();

      // In serial_override mode, check for LOTTERY_SERIAL_OVERRIDE permission
      if (isSerialOverrideMode) {
        const hasSerialOverridePermission = result.permissions?.includes('LOTTERY_SERIAL_OVERRIDE');
        if (!hasSerialOverridePermission) {
          setManagementError(
            'You do not have permission to override the starting serial. Only users with LOTTERY_SERIAL_OVERRIDE permission can approve this change.'
          );
          return;
        }
        // Call the serial override callback
        if (onSerialOverrideApproved) {
          onSerialOverrideApproved({
            approver_id: result.user_id,
            approver_name: result.name || result.email,
            approved_at: new Date(),
            has_permission: true,
          });
        }
      } else if (isMarkSoldMode) {
        // In mark_sold mode, check for LOTTERY_MARK_SOLD permission
        const hasMarkSoldPermission = result.permissions?.includes('LOTTERY_MARK_SOLD');
        if (!hasMarkSoldPermission) {
          setManagementError(
            'You do not have permission to mark packs as sold. Only users with LOTTERY_MARK_SOLD permission can approve this action.'
          );
          return;
        }
        // Call the mark sold callback
        if (onMarkSoldApproved) {
          onMarkSoldApproved({
            approver_id: result.user_id,
            approver_name: result.name || result.email,
            approved_at: new Date(),
            has_permission: true,
          });
        }
      } else {
        // Regular activation mode - pass auth result
        onAuthenticated({
          cashier_id: result.user_id,
          cashier_name: result.name || result.email,
          shift_id: '', // Managers don't need a shift
          auth_type: 'management',
          permissions: result.permissions,
        });
      }
      onOpenChange(false);
    } catch (err) {
      // SEC-010: AUTHZ - Handle credential verification errors without triggering lockout
      // The API client now properly distinguishes credential verification 401s from session expiration
      if (err instanceof Error) {
        const errorMessage = err.message.toLowerCase();
        // Check for ApiError code property if available
        const errorCode = 'code' in err ? (err as { code?: string }).code : undefined;

        if (
          errorCode === 'INSUFFICIENT_PERMISSIONS' ||
          errorMessage.includes('insufficient_permissions') ||
          errorMessage.includes('does not have manager permissions')
        ) {
          setManagementError(
            'You do not have permission to activate lottery packs. Please contact your administrator for access.'
          );
        } else if (
          errorCode === 'UNAUTHORIZED' ||
          errorMessage === 'unauthorized' ||
          errorMessage.includes('invalid email or password') ||
          errorMessage.includes('invalid credentials')
        ) {
          setManagementError('Invalid email or password.');
        } else if (
          errorMessage.includes('inactive') ||
          errorMessage.includes('account is inactive')
        ) {
          setManagementError('Account is inactive. Please contact support.');
        } else {
          // Generic error - do not expose internal details
          setManagementError('Authentication failed. Please try again.');
        }
      } else {
        setManagementError('Authentication failed. Please try again.');
      }
    }
  };

  const handleCancel = () => {
    setPin('');
    setCashierError(null);
    setEmail('');
    setPassword('');
    setManagementError(null);
    onOpenChange(false);
  };

  const isCashierFormValid = pin.length === 4;
  const isManagementFormValid = email.includes('@') && password.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="lottery-auth-modal">
        <DialogHeader>
          <DialogTitle>
            {isManagerOnlyMode ? 'Manager Approval Required' : 'Authentication Required'}
          </DialogTitle>
          <DialogDescription>
            {isSerialOverrideMode
              ? 'A manager must approve changing the starting serial. This action will be recorded.'
              : isMarkSoldMode
                ? 'A manager must approve marking this pack as sold. This action will be recorded.'
                : 'Authenticate to activate the pack. This action will be recorded.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'cashier' | 'management')}
          className="w-full"
        >
          {/* In manager-only modes (serial_override, mark_sold), only show management tab */}
          {!isManagerOnlyMode && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cashier" disabled={isSubmitting} data-testid="cashier-tab">
                <User className="mr-2 h-4 w-4" />
                Cashier
              </TabsTrigger>
              <TabsTrigger value="management" disabled={isSubmitting} data-testid="management-tab">
                <Shield className="mr-2 h-4 w-4" />
                Management
              </TabsTrigger>
            </TabsList>
          )}

          {/* Cashier Tab - PIN Only */}
          <TabsContent value="cashier" data-testid="cashier-tab-content">
            <form onSubmit={handleCashierSubmit} className="space-y-4">
              {cashierError && (
                <Alert variant="destructive">
                  <AlertDescription data-testid="cashier-error-message">
                    {cashierError}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="pin-input">PIN</Label>
                <Input
                  ref={pinInputRef}
                  id="pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="Enter your 4-digit PIN"
                  value={pin}
                  onChange={(e) => {
                    // Only allow numeric input
                    const value = e.target.value.replace(/\D/g, '');
                    setPin(value);
                  }}
                  disabled={isSubmitting}
                  autoComplete="off"
                  data-testid="pin-input"
                />
                <p className="text-xs text-muted-foreground">
                  Enter your 4-digit cashier PIN. You must have an active shift.
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                  data-testid="cancel-button"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !isCashierFormValid}
                  data-testid="authenticate-button"
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Authenticate
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* Management Tab - Email/Password */}
          <TabsContent value="management" data-testid="management-tab-content">
            <form onSubmit={handleManagementSubmit} className="space-y-4">
              {managementError && (
                <Alert variant="destructive">
                  <AlertDescription data-testid="management-error-message">
                    {managementError}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email-input">Email</Label>
                <Input
                  ref={emailInputRef}
                  id="email-input"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                  disabled={isSubmitting}
                  autoComplete="email"
                  data-testid="email-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password-input">Password</Label>
                <Input
                  id="password-input"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  data-testid="password-input"
                />
                <p className="text-xs text-muted-foreground">
                  Manager authentication does not require an active shift.
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                  data-testid="cancel-button"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !isManagementFormValid}
                  data-testid="authenticate-button"
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Authenticate
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
