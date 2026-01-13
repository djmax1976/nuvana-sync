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

    if (!result.success) {
      // Return error without revealing details
      return createErrorResponse(
        IPCErrorCodes.NOT_AUTHENTICATED,
        result.error || 'Authentication failed'
      );
    }

    // Return success with user info (no sensitive data)
    return createSuccessResponse({
      user: {
        userId: result.user!.user_id,
        name: result.user!.name,
        role: result.user!.role,
      },
      session: {
        loginAt: result.session!.loginAt,
        timeoutIn: result.session!.timeoutIn,
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

    if (!result.success) {
      return createErrorResponse(
        IPCErrorCodes.NOT_AUTHENTICATED,
        result.error || 'Authentication failed'
      );
    }

    return createSuccessResponse({
      user: {
        userId: result.user!.user_id,
        name: result.user!.name,
        role: result.user!.role,
      },
      session: {
        loginAt: result.session!.loginAt,
        timeoutIn: result.session!.timeoutIn,
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
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Invalid role check request'
      );
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

// Log handler registration
log.info('Auth IPC handlers registered');
