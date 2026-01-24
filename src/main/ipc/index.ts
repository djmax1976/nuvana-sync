/**
 * IPC Handler Registration System
 *
 * Centralized IPC handler management with:
 * - Role-based permission checks
 * - Structured error handling
 * - Execution logging and metrics
 * - Type-safe handler registration
 *
 * @module main/ipc
 * @security API-004: Authentication validation for protected endpoints
 * @security API-003: Centralized error handling with sanitized responses
 * @security SEC-017: Audit logging for security-sensitive actions
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * User role hierarchy (lowest to highest privilege)
 * MVP roles: cashier < shift_manager < store_manager
 */
export type UserRole = 'cashier' | 'shift_manager' | 'store_manager';

/**
 * Current session user
 */
export interface SessionUser {
  user_id: string;
  username: string;
  role: UserRole;
  store_id: string;
}

/**
 * Handler options for permission and behavior configuration
 */
export interface HandlerOptions {
  /** Require authentication to access this endpoint */
  requiresAuth?: boolean;
  /** Minimum role required (uses hierarchy: CASHIER < MANAGER < ADMIN) */
  requiredRole?: UserRole;
  /** Log execution time (default: true) */
  logTiming?: boolean;
  /** Custom description for audit logging */
  description?: string;
}

/**
 * Handler function type
 * @template T - Return type
 */
type HandlerFn<T = unknown> = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T;

/**
 * Standard IPC response format
 */
export interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Error codes for IPC responses
 */
export const IPCErrorCodes = {
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  ALREADY_CLOSED: 'ALREADY_CLOSED',
  OPEN_SHIFTS: 'OPEN_SHIFTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONFLICT: 'CONFLICT',
  /** API-002: Rate limit exceeded */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type IPCErrorCode = (typeof IPCErrorCodes)[keyof typeof IPCErrorCodes];

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('ipc');

// ============================================================================
// Session Management (Placeholder - will be enhanced in Phase 4)
// ============================================================================

/**
 * Current session user (null if not authenticated)
 * In Phase 4, this will be managed by a proper session service
 */
let currentUser: SessionUser | null = null;

/**
 * Get current authenticated user
 * API-004: Returns null if not authenticated
 */
export function getCurrentUser(): SessionUser | null {
  return currentUser;
}

/**
 * Set current user session (for login handler)
 */
export function setCurrentUser(user: SessionUser | null): void {
  currentUser = user;
  if (user) {
    log.info('User session established', { userId: user.user_id, role: user.role });
  } else {
    log.info('User session cleared');
  }
}

// ============================================================================
// Role Hierarchy
// ============================================================================

/**
 * Role hierarchy for permission checks
 * Lower index = lower privilege
 */
const ROLE_HIERARCHY: UserRole[] = ['cashier', 'shift_manager', 'store_manager'];

/**
 * Check if user has required role
 * @param userRole - User's current role
 * @param requiredRole - Minimum required role
 * @returns true if user has sufficient privileges
 */
function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY.indexOf(userRole);
  const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}

// ============================================================================
// Handler Registry
// ============================================================================

/**
 * Registry of all registered handlers with their options
 */
const handlerRegistry = new Map<string, { fn: HandlerFn; options: HandlerOptions }>();

/**
 * Register an IPC handler with optional permission and logging configuration
 *
 * @template T - Return type of the handler
 * @param channel - IPC channel name
 * @param handler - Handler function
 * @param options - Handler configuration options
 *
 * @example
 * ```typescript
 * registerHandler('dashboard:getStats', async () => {
 *   return { todaySales: 1000 };
 * });
 *
 * registerHandler('shifts:close', async (event, shiftId) => {
 *   return closeShift(shiftId);
 * }, { requiresAuth: true, requiredRole: 'shift_manager' });
 * ```
 */
export function registerHandler<T>(
  channel: string,
  handler: HandlerFn<T>,
  options: HandlerOptions = {}
): void {
  // Prevent duplicate registration
  if (handlerRegistry.has(channel)) {
    log.warn('Handler already registered, skipping', { channel });
    return;
  }

  // Store in registry for tracking
  handlerRegistry.set(channel, { fn: handler as HandlerFn, options });

  // Register with ipcMain
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const startTime = Date.now();
    const { requiresAuth, requiredRole, logTiming = true } = options;

    try {
      // API-004: Authentication check
      if (requiresAuth) {
        const user = getCurrentUser();
        if (!user) {
          log.warn('Unauthorized IPC access attempt', { channel });
          return {
            success: false,
            error: IPCErrorCodes.NOT_AUTHENTICATED,
            message: 'Authentication required. Please log in.',
          };
        }

        // Role-based authorization check
        if (requiredRole && !hasRequiredRole(user.role, requiredRole)) {
          log.warn('Insufficient permissions for IPC handler', {
            channel,
            userRole: user.role,
            requiredRole,
          });
          return {
            success: false,
            error: IPCErrorCodes.FORBIDDEN,
            message: `Insufficient permissions. Required role: ${requiredRole}`,
          };
        }
      }

      // Execute handler
      const result = await handler(event, ...args);

      // Log timing if enabled
      if (logTiming) {
        const duration = Date.now() - startTime;
        log.debug('IPC handler executed', {
          channel,
          duration: `${duration}ms`,
          success: true,
        });
      }

      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;

      // API-003: Centralized error handling with sanitized responses
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Log full error details server-side
      log.error('IPC handler error', {
        channel,
        duration: `${duration}ms`,
        error: errorMessage,
        stack: errorStack,
      });

      // Return sanitized error to client
      return {
        success: false,
        error: IPCErrorCodes.INTERNAL_ERROR,
        message: 'An internal error occurred. Please try again.',
      };
    }
  });

  log.debug('IPC handler registered', {
    channel,
    requiresAuth: options.requiresAuth ?? false,
    requiredRole: options.requiredRole ?? 'none',
  });
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(code: IPCErrorCode, message: string): IPCResponse {
  return { success: false, error: code, message };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(data: T): IPCResponse<T> {
  return { success: true, data };
}

// ============================================================================
// Handler Initialization
// ============================================================================

/**
 * Initialize all IPC handlers
 * Called once during app startup
 */
export async function initializeIPC(): Promise<void> {
  log.info('Initializing IPC handlers');

  // Import and register all handler modules
  // Each module registers its own handlers when imported
  await import('./stores.handlers');
  await import('./dashboard.handlers');
  await import('./shifts.handlers');
  await import('./day-summaries.handlers');
  await import('./transactions.handlers');
  await import('./reports.handlers');
  await import('./auth.handlers');
  await import('./lottery.handlers');
  await import('./sync.handlers');
  await import('./settings.handlers');
  await import('./bins.handlers');
  await import('./license.handlers');
  await import('./employees.handlers');
  await import('./terminals.handlers');

  log.info('IPC handlers initialized', {
    totalHandlers: handlerRegistry.size,
    channels: Array.from(handlerRegistry.keys()),
  });
}

/**
 * Get list of registered handler channels
 * Useful for debugging and documentation
 */
export function getRegisteredChannels(): string[] {
  return Array.from(handlerRegistry.keys());
}

/**
 * Check if a channel is registered
 */
export function isChannelRegistered(channel: string): boolean {
  return handlerRegistry.has(channel);
}
