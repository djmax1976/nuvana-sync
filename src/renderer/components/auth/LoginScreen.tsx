/**
 * Login Screen Component
 *
 * Full-screen login interface for PIN-based authentication.
 * Used as the entry point when no user is authenticated.
 *
 * @module renderer/components/auth/LoginScreen
 * @security SEC-001: PIN verification uses bcrypt (via main process)
 * @security SEC-011: Brute-force protection via main process delay
 * @security SEC-014: Input validation with format constraints
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Lock, User, Store } from 'lucide-react';
import { useAuth, type UserRole } from '@/contexts/AuthContext';

// ============================================================================
// Types
// ============================================================================

interface UserOption {
  userId: string;
  name: string;
  role: UserRole;
}

interface LoginScreenProps {
  /** Store name to display in header */
  storeName?: string;
  /** Callback when login succeeds */
  onLoginSuccess?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * LoginScreen component
 * Full-screen PIN entry interface with optional user selection
 */
export function LoginScreen({ storeName, onLoginSuccess }: LoginScreenProps) {
  // Auth context
  const { loginByPin, loginWithUser, loginError, clearLoginError, isLoading, getUsers } =
    useAuth();

  // Local state
  const [pin, setPin] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Refs
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Load users on mount
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const userList = await getUsers();
        setUsers(userList);
      } catch (error) {
        console.error('[LoginScreen] Failed to load users:', error);
        setLocalError('Failed to load user list');
      } finally {
        setUsersLoading(false);
      }
    };

    loadUsers();
  }, [getUsers]);

  // Focus PIN input on mount and when user is selected
  useEffect(() => {
    const timer = setTimeout(() => {
      pinInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedUserId]);

  // Clear errors when PIN changes
  useEffect(() => {
    if (loginError) {
      clearLoginError();
    }
    if (localError) {
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  /**
   * Handle PIN input change
   * Only allow digits, max 6 characters
   */
  const handlePinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
  }, []);

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // SEC-014: INPUT_VALIDATION - Validate PIN format (4-6 digits)
    if (!pin || pin.length < 4 || pin.length > 6) {
      setLocalError('PIN must be 4-6 digits');
      return;
    }

    setIsSubmitting(true);

    try {
      let success: boolean;

      if (selectedUserId) {
        // Login with specific user
        success = await loginWithUser(selectedUserId, pin);
      } else {
        // Login by PIN only (user determined by match)
        success = await loginByPin(pin);
      }

      if (success) {
        setPin('');
        setSelectedUserId('');
        onLoginSuccess?.();
      }
    } catch (error) {
      console.error('[LoginScreen] Login error:', error);
      setLocalError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle Enter key for quick submit
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && pin.length >= 4) {
      handleSubmit(e);
    }
  };

  // Display error (prefer login error from context, fall back to local)
  const displayError = loginError || localError;
  const isFormValid = pin.length >= 4 && pin.length <= 6;
  const isDisabled = isSubmitting || isLoading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          {/* Store Logo/Icon */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Store className="h-8 w-8 text-primary" />
          </div>

          {/* Store Name */}
          <div>
            <CardTitle className="text-2xl font-bold">
              {storeName || 'Nuvana Sync'}
            </CardTitle>
            <CardDescription className="mt-2">
              Enter your PIN to continue
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error Alert */}
            {displayError && (
              <Alert variant="destructive" data-testid="login-error">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            )}

            {/* User Selection (optional) */}
            {users.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="user-select" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Select User (optional)
                </Label>
                <Select
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                  disabled={isDisabled || usersLoading}
                >
                  <SelectTrigger id="user-select" data-testid="user-select">
                    <SelectValue placeholder="Any user (auto-detect)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any user (auto-detect)</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.userId} value={user.userId}>
                        {user.name} ({user.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Select your name or leave blank to auto-detect by PIN
                </p>
              </div>
            )}

            {/* Single user display */}
            {users.length === 1 && (
              <div className="rounded-lg border bg-muted/50 p-3 text-center">
                <p className="text-sm text-muted-foreground">Logging in as</p>
                <p className="font-medium">{users[0].name}</p>
              </div>
            )}

            {/* PIN Input */}
            <div className="space-y-2">
              <Label htmlFor="pin-input" className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                PIN
              </Label>
              <Input
                ref={pinInputRef}
                id="pin-input"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                placeholder="Enter your PIN"
                value={pin}
                onChange={handlePinChange}
                onKeyDown={handleKeyDown}
                disabled={isDisabled}
                autoComplete="off"
                autoFocus
                className="text-center text-2xl tracking-widest"
                data-testid="pin-input"
              />
              <p className="text-xs text-muted-foreground text-center">
                4-6 digit PIN
              </p>
            </div>

            {/* PIN Dots Indicator */}
            <div className="flex justify-center gap-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div
                  key={index}
                  className={`h-3 w-3 rounded-full transition-colors ${
                    index < pin.length
                      ? 'bg-primary'
                      : index < 4
                        ? 'bg-muted-foreground/30'
                        : 'bg-muted-foreground/10'
                  }`}
                />
              ))}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isDisabled || !isFormValid}
              data-testid="login-button"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-5 w-5" />
                  Login
                </>
              )}
            </Button>
          </form>

          {/* Help Text */}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Session will timeout after 15 minutes of inactivity
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
