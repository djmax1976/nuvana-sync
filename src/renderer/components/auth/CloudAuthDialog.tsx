/**
 * Cloud Authentication Dialog
 *
 * A dialog that prompts for email/password login against the cloud API.
 * Only allows users with SUPPORT or SUPERADMIN roles to access.
 *
 * @module renderer/components/auth/CloudAuthDialog
 * @security SEC-001: Cloud-based authentication with email/password
 */

import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { AlertCircle, Shield, Loader2 } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

/**
 * Verified cloud user information returned on successful login
 */
export interface CloudAuthUser {
  userId: string;
  email: string;
  name: string;
  roles: string[];
}

export interface CloudAuthDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Callback when authentication is successful - receives verified user info */
  onAuthenticated: (user: CloudAuthUser) => void;
  /** Title to display in the dialog */
  title?: string;
  /** Description text */
  description?: string;
  /** Required roles (defaults to SUPPORT and SUPERADMIN) */
  requiredRoles?: string[];
}

interface CloudAuthResponse {
  success: boolean;
  data?: {
    user: {
      id: string;
      email: string;
      name: string;
      roles: string[];
    };
  };
  error?: string;
  message?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Allowed roles for settings access */
const ALLOWED_ROLES = ['SUPPORT', 'SUPERADMIN'];

// ============================================================================
// Component
// ============================================================================

export function CloudAuthDialog({
  open,
  onClose,
  onAuthenticated,
  title = 'Support Authentication',
  description = 'This area is restricted to authorized support personnel only.',
  requiredRoles = ALLOWED_ROLES,
}: CloudAuthDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Focus email input when dialog opens
  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setError(null);
      // Small delay to ensure dialog is rendered
      setTimeout(() => emailInputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      // Call cloud auth IPC handler
      const response = await window.electronAPI.invoke<CloudAuthResponse>('auth:cloudLogin', {
        email: email.trim().toLowerCase(),
        password,
      });

      if (!response.success) {
        setError(response.error || response.message || 'Authentication failed');
        setPassword('');
        return;
      }

      const user = response.data?.user;
      if (!user) {
        setError('Invalid response from server');
        setPassword('');
        return;
      }

      // Check if user has required role
      const userRoles = user.roles.map((r) => r.toUpperCase());
      const hasRequiredRole = requiredRoles.some((role) => userRoles.includes(role.toUpperCase()));

      if (!hasRequiredRole) {
        setError(
          `Access denied. Only ${requiredRoles.join(' or ')} roles are authorized to access this area.`
        );
        setEmail('');
        setPassword('');
        return;
      }

      // Success - user verified and has required role
      const cloudUser: CloudAuthUser = {
        userId: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      };
      onAuthenticated(cloudUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setPassword('');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label htmlFor="cloud-email" className="text-sm font-medium">
              Email
            </label>
            <Input
              ref={emailInputRef}
              id="cloud-email"
              type="email"
              placeholder="support@nuvanapos.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              disabled={isAuthenticating}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="cloud-password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="cloud-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              disabled={isAuthenticating}
              autoComplete="current-password"
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Only authorized support personnel can access this area
          </p>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={isAuthenticating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isAuthenticating || !email.trim() || !password}>
              {isAuthenticating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Login'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CloudAuthDialog;
