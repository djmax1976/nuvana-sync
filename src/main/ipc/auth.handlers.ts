/**
 * Authentication IPC Handlers
 *
 * Handles authentication-related IPC requests from the renderer process.
 * All handlers validate input using Zod schemas per API-001.
 *
 * @module main/ipc/auth.handlers
 * @security API-001: Input validation with Zod schemas
 * @security API-004: Authentication checks where required
 * @security SEC-011: Brute-force protection via auth service
 * @security SEC-017: Audit logging for auth events
 */

import { z } from 'zod';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes,
} from './index';
import {
  authenticateByPin,
  authenticateUser,
  logout,
  getCurrentAuthUser,
  getCurrentSession,
  trackActivity,
  getActiveUsersForLogin,
  hasPermission,
  hasMinimumRole,
} from '../services/auth.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('auth-handlers');

// ============================================================================
// Validation Schemas (API-001)
// ============================================================================

/**
 * PIN format: 4-6 digits
 */
const PinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits');

/**
 * Login with PIN only (user determined by PIN match)
 */
const LoginByPinSchema = z.object({
  pin: PinSchema,
});

/**
 * Login with user selection
 */
const LoginWithUserSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  pin: PinSchema,
});

/**
 * Permission check request
 */
const PermissionCheckSchema = z.object({
  permission: z.string().min(1),
});

/**
 * Role check request
 */
const RoleCheckSchema = z.object({
  requiredRole: z.enum(['cashier', 'shift_manager', 'store_manager']),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * Login with PIN
 * Attempts to match PIN against all active users
 * No authentication required (this is the login endpoint)
 *
 * Channel: auth:login
 */
registerHandler(
  'auth:login',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = LoginByPinSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { pin } = parseResult.data;

    // Attempt authentication
    const result = await authenticateByPin(pin);

    if (!result.success || !result.user || !result.session) {
      // Return error with attempts remaining info for UI feedback
      return {
        success: false,
        error: result.error || 'Authentication failed',
        errorCode: result.errorCode,
        attemptsRemaining: result.attemptsRemaining,
        maxAttempts: result.maxAttempts,
      };
    }

    // Return success with user info (no sensitive data)
    return createSuccessResponse({
      user: {
        userId: result.user.user_id,
        name: result.user.name,
        role: result.user.role,
      },
      session: {
        loginAt: result.session.loginAt,
        timeoutIn: result.session.timeoutIn,
      },
    });
  },
  {
    description: 'Authenticate user with PIN',
  }
);

/**
 * Login with user ID and PIN
 * Used when user is pre-selected from a list
 * No authentication required (this is the login endpoint)
 *
 * Channel: auth:loginWithUser
 */
registerHandler(
  'auth:loginWithUser',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = LoginWithUserSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { userId, pin } = parseResult.data;

    // Attempt authentication
    const result = await authenticateUser(userId, pin);

    if (!result.success || !result.user || !result.session) {
      // Return error with attempts remaining info for UI feedback
      return {
        success: false,
        error: result.error || 'Authentication failed',
        errorCode: result.errorCode,
        attemptsRemaining: result.attemptsRemaining,
        maxAttempts: result.maxAttempts,
      };
    }

    return createSuccessResponse({
      user: {
        userId: result.user.user_id,
        name: result.user.name,
        role: result.user.role,
      },
      session: {
        loginAt: result.session.loginAt,
        timeoutIn: result.session.timeoutIn,
      },
    });
  },
  {
    description: 'Authenticate specific user with PIN',
  }
);

/**
 * Logout current user
 * Requires authentication
 *
 * Channel: auth:logout
 */
registerHandler(
  'auth:logout',
  async () => {
    logout();
    return createSuccessResponse({ success: true });
  },
  {
    requiresAuth: true,
    description: 'End user session',
  }
);

/**
 * Get current authenticated user
 * No authentication required - returns null if not logged in
 *
 * Channel: auth:getCurrentUser
 */
registerHandler(
  'auth:getCurrentUser',
  async () => {
    const user = getCurrentAuthUser();

    if (!user) {
      return createSuccessResponse({
        authenticated: false,
        user: null,
      });
    }

    const session = getCurrentSession();

    return createSuccessResponse({
      authenticated: true,
      user: {
        userId: user.userId,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
      },
      session: session
        ? {
            loginAt: session.loginAt,
            lastActivityAt: session.lastActivityAt,
            timeoutIn: session.timeoutIn,
          }
        : null,
    });
  },
  {
    description: 'Get current authenticated user',
  }
);

/**
 * Update session activity
 * Resets inactivity timer
 * Requires authentication
 *
 * Channel: auth:updateActivity
 */
registerHandler(
  'auth:updateActivity',
  async () => {
    trackActivity();
    return createSuccessResponse({ success: true });
  },
  {
    requiresAuth: true,
    description: 'Update session activity timestamp',
  }
);

/**
 * Get list of active users for login selection
 * No authentication required (needed for login screen)
 *
 * Channel: auth:getUsers
 */
registerHandler(
  'auth:getUsers',
  async () => {
    const users = getActiveUsersForLogin();

    return createSuccessResponse(
      users.map((u) => ({
        userId: u.user_id,
        name: u.name,
        role: u.role,
      }))
    );
  },
  {
    description: 'Get list of active users for login',
  }
);

/**
 * Check if store has any active store managers
 * No authentication required (needed for settings access check)
 *
 * Channel: auth:hasStoreManager
 */
registerHandler(
  'auth:hasStoreManager',
  async () => {
    const users = getActiveUsersForLogin();
    const managers = users.filter((u) => u.role === 'store_manager');

    return createSuccessResponse({
      hasManager: managers.length > 0,
      managerCount: managers.length,
    });
  },
  {
    description: 'Check if store has active store managers',
  }
);

/**
 * Check if current user has a specific permission
 * Requires authentication
 *
 * Channel: auth:hasPermission
 */
registerHandler(
  'auth:hasPermission',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = PermissionCheckSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Invalid permission check request'
      );
    }

    const { permission } = parseResult.data;
    const user = getCurrentAuthUser();

    if (!user) {
      return createSuccessResponse({ hasPermission: false });
    }

    const result = hasPermission(user, permission);
    return createSuccessResponse({ hasPermission: result });
  },
  {
    requiresAuth: true,
    description: 'Check if user has specific permission',
  }
);

/**
 * Check if current user has at least the specified role
 * Requires authentication
 *
 * Channel: auth:hasMinimumRole
 */
registerHandler(
  'auth:hasMinimumRole',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = RoleCheckSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid role check request');
    }

    const { requiredRole } = parseResult.data;
    const user = getCurrentAuthUser();

    if (!user) {
      return createSuccessResponse({ hasRole: false });
    }

    const result = hasMinimumRole(user, requiredRole);
    return createSuccessResponse({ hasRole: result });
  },
  {
    requiresAuth: true,
    description: 'Check if user has minimum role level',
  }
);

/**
 * Check if user has a valid session for PIN-protected operations
 * FE-001: Enables frontend to skip PIN re-entry if session is still valid
 * SEC-010: Validates role requirement server-side
 *
 * This allows the frontend to check if the user is already authenticated
 * with sufficient privileges, avoiding unnecessary PIN re-prompts within
 * the 15-minute session window.
 *
 * No authentication required (this checks if user IS authenticated)
 *
 * Channel: auth:checkSessionForRole
 */
registerHandler(
  'auth:checkSessionForRole',
  async (_event, input: unknown) => {
    // Lazy import to avoid circular dependencies
    const { hasValidSessionForRole } = await import('../services/session.service');

    // API-001: Validate input
    const parseResult = RoleCheckSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid role check request');
    }

    const { requiredRole } = parseResult.data;
    const result = hasValidSessionForRole(requiredRole);

    // Debug logging to diagnose session bypass issues
    log.info('Session check for role', {
      requiredRole,
      valid: result.valid,
      userId: result.user?.userId,
      userRole: result.user?.role,
      timeoutIn: result.timeoutIn,
    });

    return createSuccessResponse(result);
  },
  {
    description: 'Check if user has valid session for PIN-protected operation',
  }
);

// ============================================================================
// Cloud Authentication (Support/Admin Access)
// ============================================================================

/**
 * Cloud login schema for email/password authentication
 * API-001: Schema validation with strict types
 * SEC-014: Input validation with length constraints
 */
const CloudLoginSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .max(254, 'Email too long') // RFC 5321 limit
    .transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required').max(128, 'Password too long'), // Reasonable limit to prevent DoS
});

/**
 * SEC-011 & API-002: Rate limiting state for cloud authentication
 * In-memory rate limiter to prevent brute-force attacks
 *
 * Configuration:
 * - Max 5 attempts per 15 minutes (900 seconds) per email
 * - 2 second delay after each failed attempt
 * - Lockout after max attempts reached
 */
const CLOUD_AUTH_RATE_LIMIT = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  failedAttemptDelayMs: 2000, // 2 seconds delay after failed attempt
};

/**
 * In-memory rate limit tracker
 * Key: normalized email, Value: { attempts, windowStart }
 */
const cloudAuthAttempts = new Map<string, { attempts: number; windowStart: number }>();

/**
 * SEC-011: Check and update rate limit for cloud authentication
 * @returns true if request is allowed, false if rate limited
 */
function checkCloudAuthRateLimit(email: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const key = email.toLowerCase().trim();
  const record = cloudAuthAttempts.get(key);

  // No record or window expired - allow and reset
  if (!record || now - record.windowStart > CLOUD_AUTH_RATE_LIMIT.windowMs) {
    cloudAuthAttempts.set(key, { attempts: 1, windowStart: now });
    return { allowed: true };
  }

  // Check if limit exceeded
  if (record.attempts >= CLOUD_AUTH_RATE_LIMIT.maxAttempts) {
    const retryAfterMs = CLOUD_AUTH_RATE_LIMIT.windowMs - (now - record.windowStart);
    return { allowed: false, retryAfterMs };
  }

  // Increment attempts
  record.attempts++;
  return { allowed: true };
}

/**
 * SEC-011: Reset rate limit on successful authentication
 */
function resetCloudAuthRateLimit(email: string): void {
  cloudAuthAttempts.delete(email.toLowerCase().trim());
}

/**
 * SEC-011: Apply delay after failed login attempt
 */
async function applyCloudAuthFailedDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, CLOUD_AUTH_RATE_LIMIT.failedAttemptDelayMs));
}

/**
 * Cleanup stale rate limit records periodically
 * Prevents memory leaks from abandoned attempts
 */
setInterval(
  () => {
    const now = Date.now();
    const keysToDelete: string[] = [];

    cloudAuthAttempts.forEach((record, key) => {
      if (now - record.windowStart > CLOUD_AUTH_RATE_LIMIT.windowMs) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => cloudAuthAttempts.delete(key));
  },
  5 * 60 * 1000
); // Cleanup every 5 minutes

/**
 * Cloud login with email and password
 * Used for support/admin staff accessing settings
 * No authentication required (this is the login endpoint)
 *
 * @security API-001: Input validation with Zod schema
 * @security API-002: Rate limiting per email address
 * @security SEC-011: Brute-force protection via rate limit and delay
 * @security SEC-017: Audit logging for authentication events
 * @security API-003: Generic error messages to prevent enumeration
 *
 * Channel: auth:cloudLogin
 */
registerHandler(
  'auth:cloudLogin',
  async (_event, input: unknown) => {
    // Lazy import to avoid circular dependencies
    const { cloudApiService } = await import('../services/cloud-api.service');

    // API-001: Validate input with schema
    const parseResult = CloudLoginSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { email, password } = parseResult.data;

    // API-002 & SEC-011: Check rate limit before processing
    const rateLimit = checkCloudAuthRateLimit(email);
    if (!rateLimit.allowed) {
      const retryAfterSec = Math.ceil((rateLimit.retryAfterMs || 0) / 1000);
      log.warn('Cloud authentication rate limited', {
        email: email.substring(0, 3) + '***',
        retryAfterSec,
      });
      return createErrorResponse(
        IPCErrorCodes.RATE_LIMITED,
        `Too many login attempts. Please try again in ${retryAfterSec} seconds.`
      );
    }

    // SEC-017: Log authentication attempt (no sensitive data)
    log.info('Cloud authentication attempt', {
      email: email.substring(0, 3) + '***',
    });

    try {
      // Attempt cloud authentication
      const result = await cloudApiService.authenticateCloudUser(email, password);

      if (!result.success) {
        // SEC-011: Apply delay on failed attempt
        await applyCloudAuthFailedDelay();

        log.warn('Cloud authentication failed', {
          email: email.substring(0, 3) + '***',
          // API-003: Don't log specific error to prevent enumeration leakage
        });

        // API-003: Return generic error message
        return createErrorResponse(IPCErrorCodes.NOT_AUTHENTICATED, 'Invalid email or password');
      }

      // SEC-011: Reset rate limit on successful login
      resetCloudAuthRateLimit(email);

      log.info('Cloud authentication successful', {
        userId: result.user?.id,
        roles: result.user?.roles,
      });

      return createSuccessResponse({
        user: result.user,
      });
    } catch (error) {
      // SEC-011: Apply delay on error
      await applyCloudAuthFailedDelay();

      log.error('Cloud authentication error', {
        error: error instanceof Error ? error.message : String(error),
      });

      // API-003: Return generic error message
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Authentication failed. Please try again later.'
      );
    }
  },
  {
    description: 'Authenticate support/admin user with cloud credentials',
  }
);

// Log handler registration
log.info('Auth IPC handlers registered');
