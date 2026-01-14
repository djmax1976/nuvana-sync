/**
 * Manual Entry Authentication Modal Component
 * Dialog form for authorizing manual entry mode in lottery management
 *
 * Story: 10.4 - Manual Entry Override
 *
 * @requirements
 * - AC #2: Modal with user authentication form (email/password)
 * - AC #3: Permission check for LOTTERY_MANUAL_ENTRY
 * - Email input field
 * - Password input field (masked)
 * - Cancel and Verify buttons
 * - Error handling for invalid credentials and unauthorized users
 * - Audit trail: Records who authorized manual entry for compliance
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Mirror backend validation client-side
 * - SEC-014: INPUT_VALIDATION - Strict schemas with format constraints
 * - SEC-004: XSS - React auto-escapes output
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useMutation } from '@tanstack/react-query';

/**
 * Form validation schema for manual entry authentication
 * Validates email (required, valid format) and password (required)
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Mirror backend validation client-side
 * - SEC-014: INPUT_VALIDATION - Define strict schemas with format constraints
 */
const manualEntryAuthFormSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .min(1, { message: 'Email is required' })
    .email({ message: 'Please enter a valid email address' }),
  password: z
    .string({ message: 'Password is required' })
    .min(1, { message: 'Password is required' }),
});

type ManualEntryAuthFormValues = z.infer<typeof manualEntryAuthFormSchema>;

/**
 * User permission verification result
 */
export interface UserPermissionVerificationResult {
  valid: boolean;
  userId?: string;
  name?: string;
  hasPermission?: boolean;
  error?: string;
}

interface ManualEntryAuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  onAuthorized: (authorizedBy: { userId: string; name: string }) => void;
}

/**
 * Verify user credentials and check permission
 * Calls POST /api/auth/verify-user-permission
 */
async function verifyUserPermission(
  email: string,
  password: string,
  permission: string,
  storeId: string
): Promise<UserPermissionVerificationResult> {
  const API_BASE_URL = 'http://localhost:3001';

  const response = await fetch(`${API_BASE_URL}/api/auth/verify-user-permission`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      permission,
      storeId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      valid: false,
      error: 'Unknown error',
    }));
    const errorMessage =
      typeof errorData.error === 'object'
        ? errorData.error.message
        : errorData.error || 'Verification failed';
    return {
      valid: false,
      error: errorMessage,
    };
  }

  const result = await response.json();
  return result;
}

/**
 * ManualEntryAuthModal component
 * Dialog form for authorizing manual entry mode
 * Uses React Hook Form with Zod validation
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Display validation errors clearly, disable submission until fields pass
 * - SEC-014: INPUT_VALIDATION - Apply format constraints at the boundary
 * - SEC-004: XSS - React automatically escapes output
 * - API-004: AUTHENTICATION - Secure authentication flow with proper error handling
 */
export function ManualEntryAuthModal({
  open,
  onOpenChange,
  storeId,
  onAuthorized,
}: ManualEntryAuthModalProps) {
  const form = useForm<ManualEntryAuthFormValues>({
    resolver: zodResolver(manualEntryAuthFormSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    defaultValues: {
      email: '',
      password: '',
    },
  });

  // Verify user permission mutation
  const verifyPermissionMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      verifyUserPermission(email, password, 'LOTTERY_MANUAL_ENTRY', storeId),
  });

  const isSubmitting = form.formState.isSubmitting || verifyPermissionMutation.isPending;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        email: '',
        password: '',
      });
      verifyPermissionMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (values: ManualEntryAuthFormValues) => {
    try {
      const result = await verifyPermissionMutation.mutateAsync({
        email: values.email,
        password: values.password,
      });

      // Check if credentials are valid
      if (!result.valid) {
        form.setError('root', {
          type: 'manual',
          message: result.error || 'Invalid credentials. Please try again.',
        });
        return;
      }

      // Check if user has permission
      if (!result.hasPermission) {
        form.setError('root', {
          type: 'manual',
          message: 'You are not authorized for manual entry. Minimum role required: Shift Manager',
        });
        return;
      }

      // Success - call onAuthorized callback
      if (result.userId && result.name) {
        onAuthorized({
          userId: result.userId,
          name: result.name,
        });
        onOpenChange(false);
      }
    } catch (error) {
      // Error handling is done by mutation state
      if (error instanceof Error) {
        form.setError('root', {
          type: 'manual',
          message: error.message,
        });
      }
    }
  };

  const handleCancel = () => {
    form.reset();
    onOpenChange(false);
  };

  // Disable Verify button until email and password are entered
  const watchedEmail = form.watch('email');
  const watchedPassword = form.watch('password');
  const isFormValid = watchedEmail?.length > 0 && watchedPassword?.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="manual-entry-auth-modal">
        <DialogHeader>
          <DialogTitle>Authorize Manual Entry</DialogTitle>
          <DialogDescription>
            Enter your credentials to authorize manual entry mode. This action will be recorded for
            audit purposes.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {verifyPermissionMutation.isError && (
              <Alert variant="destructive">
                <AlertDescription data-testid="error-message">
                  {verifyPermissionMutation.error instanceof Error
                    ? verifyPermissionMutation.error.message
                    : 'Verification failed. Please try again.'}
                </AlertDescription>
              </Alert>
            )}

            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription data-testid="error-message">
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="Enter your email"
                      autoComplete="email"
                      disabled={isSubmitting}
                      data-testid="email-input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      disabled={isSubmitting}
                      data-testid="password-input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                disabled={isSubmitting || !isFormValid}
                data-testid="verify-button"
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
