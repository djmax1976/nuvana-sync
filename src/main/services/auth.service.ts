/**
 * Authentication Service
 *
 * Handles PIN-based authentication for the local Electron app.
 * Delegates PIN verification to UsersDAL for SEC-001 compliance.
 *
 * @module main/services/auth
 * @security SEC-001: PIN verification uses bcrypt (delegated to usersDAL)
 * @security SEC-011: Brute-force protection via delay on failed attempts
 * @security SEC-017: Audit logging for auth events (no sensitive data)
 * @security DB-006: User lookup scoped to store_id
 */

import { usersDAL, type User, type SafeUser, UsersDAL } from '../dal/users.dal';
import { storesDAL } from '../dal/stores.dal';
import { createLogger } from '../utils/logger';
import {
  createSession,
  destroySession,
  getSessionInfo,
  getSessionUser,
  updateActivity,
  type SessionInfo,
} from './session.service';
import type { SessionUser, UserRole } from '../ipc/index';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a login attempt
 */
export interface LoginResult {
  success: boolean;
  user?: SafeUser;
  session?: SessionInfo;
  error?: string;
  errorCode?: 'STORE_NOT_CONFIGURED' | 'USER_NOT_FOUND' | 'INVALID_PIN' | 'USER_INACTIVE' | 'ACCOUNT_LOCKED';
  /** Remaining attempts before lockout (only present on failed PIN attempts) */
  attemptsRemaining?: number;
  /** Total max attempts allowed */
  maxAttempts?: number;
}

/**
 * Authenticated user info for external consumers
 */
export interface AuthenticatedUser {
  userId: string;
  name: string;
  role: UserRole;
  storeId: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * SEC-011: Delay after failed login attempt to prevent brute-force
 * Applied after each failed attempt
 */
const FAILED_LOGIN_DELAY_MS = 1000;

/**
 * SEC-011: Account lockout configuration
 * Enterprise-grade brute-force protection with escalating lockout
 *
 * @security SEC-011: Track failed attempts per account and IP, enforcing escalating lockout durations
 */
const LOCKOUT_CONFIG = {
  /** Maximum failed attempts before lockout */
  maxAttempts: 5,
  /** Base lockout duration in milliseconds (30 seconds) */
  baseLockoutMs: 30 * 1000,
  /** Maximum lockout duration in milliseconds (15 minutes) */
  maxLockoutMs: 15 * 60 * 1000,
  /** Lockout escalation multiplier (doubles each time) */
  escalationMultiplier: 2,
  /** Window for counting failed attempts (15 minutes) */
  attemptWindowMs: 15 * 60 * 1000,
  /** Cleanup interval for stale records (5 minutes) */
  cleanupIntervalMs: 5 * 60 * 1000,
} as const;

// ============================================================================
// Account Lockout State (SEC-011)
// ============================================================================

/**
 * Failed attempt tracking record
 * SEC-011: Tracks failed attempts per account for lockout enforcement
 */
interface FailedAttemptRecord {
  /** Number of consecutive failed attempts */
  attempts: number;
  /** Timestamp of first failed attempt in current window */
  windowStart: number;
  /** Timestamp when lockout expires (null if not locked) */
  lockedUntil: number | null;
  /** Number of times account has been locked (for escalation) */
  lockoutCount: number;
}

/**
 * In-memory store for failed attempt tracking
 * Key: store_id (since PIN auth tries all users in store)
 *
 * SEC-011: Track failed attempts per account and IP
 * Note: In Electron desktop app, we track by store rather than IP
 * since all requests come from local renderer process
 */
const failedAttempts = new Map<string, FailedAttemptRecord>();

/**
 * SEC-011: Check if store is currently locked out
 *
 * @param storeId - Store identifier
 * @returns Object with locked status and retry time if locked
 */
function checkLockout(storeId: string): { locked: boolean; retryAfterMs?: number } {
  const record = failedAttempts.get(storeId);

  if (!record) {
    return { locked: false };
  }

  const now = Date.now();

  // Check if lockout has expired
  if (record.lockedUntil && now < record.lockedUntil) {
    const retryAfterMs = record.lockedUntil - now;
    return { locked: true, retryAfterMs };
  }

  // Check if attempt window has expired (reset attempts)
  if (now - record.windowStart > LOCKOUT_CONFIG.attemptWindowMs) {
    // Window expired, clear record
    failedAttempts.delete(storeId);
    return { locked: false };
  }

  return { locked: false };
}

/**
 * SEC-011: Record a failed login attempt
 * Implements escalating lockout durations after threshold
 *
 * @param storeId - Store identifier
 * @returns Object with locked status, retry time, and remaining attempts
 */
function recordFailedAttempt(storeId: string): {
  locked: boolean;
  retryAfterMs?: number;
  attemptsRemaining: number;
} {
  const now = Date.now();
  let record = failedAttempts.get(storeId);

  if (!record || now - record.windowStart > LOCKOUT_CONFIG.attemptWindowMs) {
    // Start new tracking window
    record = {
      attempts: 1,
      windowStart: now,
      lockedUntil: null,
      lockoutCount: record?.lockoutCount || 0,
    };
    failedAttempts.set(storeId, record);
    return {
      locked: false,
      attemptsRemaining: LOCKOUT_CONFIG.maxAttempts - record.attempts,
    };
  }

  // Increment attempts
  record.attempts++;

  // Check if threshold reached
  if (record.attempts >= LOCKOUT_CONFIG.maxAttempts) {
    // Calculate escalating lockout duration
    const escalatedDuration = Math.min(
      LOCKOUT_CONFIG.baseLockoutMs * Math.pow(LOCKOUT_CONFIG.escalationMultiplier, record.lockoutCount),
      LOCKOUT_CONFIG.maxLockoutMs
    );

    record.lockedUntil = now + escalatedDuration;
    record.lockoutCount++;
    record.attempts = 0; // Reset attempts for next window after lockout
    record.windowStart = now;

    log.warn('Account locked due to failed attempts', {
      storeId,
      lockoutCount: record.lockoutCount,
      lockoutDurationMs: escalatedDuration,
      lockoutExpiresAt: new Date(record.lockedUntil).toISOString(),
    });

    return { locked: true, retryAfterMs: escalatedDuration, attemptsRemaining: 0 };
  }

  return {
    locked: false,
    attemptsRemaining: LOCKOUT_CONFIG.maxAttempts - record.attempts,
  };
}

/**
 * SEC-011: Reset failed attempts on successful login
 *
 * @param storeId - Store identifier
 */
function resetFailedAttempts(storeId: string): void {
  const record = failedAttempts.get(storeId);
  if (record) {
    // Keep lockoutCount for escalation history, but clear current lockout
    record.attempts = 0;
    record.lockedUntil = null;
    record.windowStart = Date.now();
  }
}

/**
 * SEC-011: Cleanup stale lockout records periodically
 * Prevents memory leaks from abandoned attempt tracking
 */
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];

  failedAttempts.forEach((record, key) => {
    // Delete if window expired and not locked
    const windowExpired = now - record.windowStart > LOCKOUT_CONFIG.attemptWindowMs;
    const lockoutExpired = !record.lockedUntil || now > record.lockedUntil;

    if (windowExpired && lockoutExpired) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => failedAttempts.delete(key));

  if (keysToDelete.length > 0) {
    log.debug('Cleaned up stale lockout records', { count: keysToDelete.length });
  }
}, LOCKOUT_CONFIG.cleanupIntervalMs);

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('auth-service');

// ============================================================================
// Permission Definitions
// ============================================================================

/**
 * Permission to role mapping
 * Defines which roles can perform which actions
 * MVP roles: cashier < shift_manager < store_manager
 */
const PERMISSIONS: Record<string, UserRole[]> = {
  // Lottery operations
  scan_lottery: ['cashier', 'shift_manager', 'store_manager'],
  view_lottery_dashboard: ['cashier', 'shift_manager', 'store_manager'],
  receive_pack: ['cashier', 'shift_manager', 'store_manager'],
  activate_pack: ['cashier', 'shift_manager', 'store_manager'],
  deplete_pack: ['cashier', 'shift_manager', 'store_manager'],
  return_pack: ['shift_manager', 'store_manager'],

  // Shift operations
  view_shift: ['cashier', 'shift_manager', 'store_manager'],
  close_shift: ['shift_manager', 'store_manager'],

  // Day operations
  view_day_summary: ['shift_manager', 'store_manager'],
  close_day: ['shift_manager', 'store_manager'],

  // Bin management
  manage_bins: ['shift_manager', 'store_manager'],
  manage_games: ['shift_manager', 'store_manager'],

  // Settings & admin
  access_settings: ['shift_manager', 'store_manager'],
  force_sync: ['shift_manager', 'store_manager'],
  view_reports: ['shift_manager', 'store_manager'],
  manage_users: ['store_manager'],
};

/**
 * Role hierarchy for privilege comparison
 * Higher index = higher privilege
 * MVP roles: cashier < shift_manager < store_manager
 */
const ROLE_HIERARCHY: UserRole[] = ['cashier', 'shift_manager', 'store_manager'];

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Convert User to SessionUser format for IPC
 */
function toSessionUser(user: User): SessionUser {
  return {
    user_id: user.user_id,
    username: user.name,
    role: user.role,
    store_id: user.store_id,
  };
}

/**
 * Add delay for brute-force protection
 * SEC-011: Prevents rapid login attempts
 */
async function applyFailedLoginDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Authenticate user by PIN
 * SEC-001: PIN verification uses bcrypt (via usersDAL.verifyPin)
 * SEC-011: Account lockout after 5 failed attempts with escalating durations
 * SEC-011: Applies delay after failed attempts
 * SEC-017: Logs auth events without sensitive data
 *
 * @param pin - User's PIN (4-6 digits)
 * @returns Login result with session info on success
 */
export async function authenticateByPin(pin: string): Promise<LoginResult> {
  // Get configured store
  const store = storesDAL.getConfiguredStore();
  if (!store) {
    log.warn('Authentication failed: Store not configured');
    return {
      success: false,
      error: 'Store not configured. Please complete setup first.',
      errorCode: 'STORE_NOT_CONFIGURED',
    };
  }

  // SEC-011: Check if store is locked out due to failed attempts
  const lockoutStatus = checkLockout(store.store_id);
  if (lockoutStatus.locked) {
    const retryAfterSec = Math.ceil((lockoutStatus.retryAfterMs || 0) / 1000);
    log.warn('Authentication blocked: Account locked', {
      storeId: store.store_id,
      retryAfterSec,
    });
    return {
      success: false,
      error: `Too many failed attempts. Please try again in ${retryAfterSec} seconds.`,
      errorCode: 'ACCOUNT_LOCKED' as const,
    };
  }

  // Get all active users for this store
  // DB-006: Store-scoped user lookup
  const users = usersDAL.findActiveByStore(store.store_id);

  if (users.length === 0) {
    log.warn('Authentication failed: No active users in store', {
      storeId: store.store_id,
    });
    await applyFailedLoginDelay();
    return {
      success: false,
      error: 'Invalid PIN',
      errorCode: 'INVALID_PIN',
    };
  }

  // Try PIN against each user
  // SEC-001: bcrypt.compare is timing-safe
  for (const user of users) {
    try {
      const isValid = await usersDAL.verifyPin(user.user_id, pin);

      if (isValid) {
        // SEC-011: Reset failed attempts on successful login
        resetFailedAttempts(store.store_id);

        // Create session
        const sessionUser = toSessionUser(user);
        const session = createSession(sessionUser);

        log.info('User authenticated successfully', {
          userId: user.user_id,
          name: user.name,
          role: user.role,
          storeId: user.store_id,
        });

        return {
          success: true,
          user: UsersDAL.toSafeUser(user),
          session,
        };
      }
    } catch (error) {
      // Log but continue - try next user
      log.error('bcrypt comparison error', {
        userId: user.user_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // No match found
  // SEC-017: Don't reveal which user failed (prevents enumeration)
  log.warn('Authentication failed: Invalid PIN', {
    storeId: store.store_id,
    attemptedUsers: users.length,
  });

  // SEC-011: Record failed attempt and check for lockout
  const lockoutResult = recordFailedAttempt(store.store_id);

  // SEC-011: Delay before returning
  await applyFailedLoginDelay();

  if (lockoutResult.locked) {
    const retryAfterSec = Math.ceil((lockoutResult.retryAfterMs || 0) / 1000);
    return {
      success: false,
      error: `Account locked for ${retryAfterSec} seconds.`,
      errorCode: 'ACCOUNT_LOCKED' as const,
      attemptsRemaining: 0,
      maxAttempts: LOCKOUT_CONFIG.maxAttempts,
    };
  }

  return {
    success: false,
    error: 'Invalid PIN',
    errorCode: 'INVALID_PIN',
    attemptsRemaining: lockoutResult.attemptsRemaining,
    maxAttempts: LOCKOUT_CONFIG.maxAttempts,
  };
}

/**
 * Authenticate specific user by PIN
 * Used when user is pre-selected (e.g., from dropdown)
 * SEC-011: Account lockout after 5 failed attempts with escalating durations
 *
 * @param userId - User ID to authenticate
 * @param pin - User's PIN
 * @returns Login result
 */
export async function authenticateUser(userId: string, pin: string): Promise<LoginResult> {
  const store = storesDAL.getConfiguredStore();
  if (!store) {
    log.warn('Authentication failed: Store not configured');
    return {
      success: false,
      error: 'Store not configured. Please complete setup first.',
      errorCode: 'STORE_NOT_CONFIGURED',
    };
  }

  // SEC-011: Check if store is locked out due to failed attempts
  const lockoutStatus = checkLockout(store.store_id);
  if (lockoutStatus.locked) {
    const retryAfterSec = Math.ceil((lockoutStatus.retryAfterMs || 0) / 1000);
    log.warn('Authentication blocked: Account locked', {
      storeId: store.store_id,
      userId,
      retryAfterSec,
    });
    return {
      success: false,
      error: `Too many failed attempts. Please try again in ${retryAfterSec} seconds.`,
      errorCode: 'ACCOUNT_LOCKED',
    };
  }

  // Find user with store validation
  // DB-006: Ensures user belongs to configured store
  const user = usersDAL.findByIdForStore(store.store_id, userId);

  if (!user) {
    log.warn('Authentication failed: User not found', {
      userId,
      storeId: store.store_id,
    });
    await applyFailedLoginDelay();
    return {
      success: false,
      error: 'User not found',
      errorCode: 'USER_NOT_FOUND',
    };
  }

  if (!user.active) {
    log.warn('Authentication failed: User inactive', {
      userId: user.user_id,
      name: user.name,
    });
    await applyFailedLoginDelay();
    return {
      success: false,
      error: 'User account is inactive',
      errorCode: 'USER_INACTIVE',
    };
  }

  // Verify PIN
  // SEC-001: bcrypt verification
  const isValid = await usersDAL.verifyPin(userId, pin);

  if (!isValid) {
    log.warn('Authentication failed: Invalid PIN', {
      userId: user.user_id,
      name: user.name,
    });

    // SEC-011: Record failed attempt and check for lockout
    const lockoutResult = recordFailedAttempt(store.store_id);

    await applyFailedLoginDelay();

    if (lockoutResult.locked) {
      const retryAfterSec = Math.ceil((lockoutResult.retryAfterMs || 0) / 1000);
      return {
        success: false,
        error: `Account locked for ${retryAfterSec} seconds.`,
        errorCode: 'ACCOUNT_LOCKED',
        attemptsRemaining: 0,
        maxAttempts: LOCKOUT_CONFIG.maxAttempts,
      };
    }

    return {
      success: false,
      error: 'Invalid PIN',
      errorCode: 'INVALID_PIN',
      attemptsRemaining: lockoutResult.attemptsRemaining,
      maxAttempts: LOCKOUT_CONFIG.maxAttempts,
    };
  }

  // SEC-011: Reset failed attempts on successful login
  resetFailedAttempts(store.store_id);

  // Create session
  const sessionUser = toSessionUser(user);
  const session = createSession(sessionUser);

  log.info('User authenticated successfully', {
    userId: user.user_id,
    name: user.name,
    role: user.role,
    storeId: user.store_id,
  });

  return {
    success: true,
    user: UsersDAL.toSafeUser(user),
    session,
  };
}

/**
 * Logout current user
 * SEC-017: Logs logout event
 */
export function logout(): void {
  const user = getSessionUser();

  if (user) {
    log.info('User logged out', {
      userId: user.user_id,
      username: user.username,
    });
  }

  destroySession();
}

/**
 * Get current authenticated user
 * Returns null if no valid session
 *
 * @returns Authenticated user info or null
 */
export function getCurrentAuthUser(): AuthenticatedUser | null {
  const user = getSessionUser();

  if (!user) {
    return null;
  }

  return {
    userId: user.user_id,
    name: user.username,
    role: user.role,
    storeId: user.store_id,
  };
}

/**
 * Get current session info
 * Includes timing information for UI display
 *
 * @returns Session info or null
 */
export function getCurrentSession(): SessionInfo | null {
  return getSessionInfo();
}

/**
 * Update session activity
 * Call on authenticated requests to keep session alive
 */
export function trackActivity(): void {
  updateActivity();
}

/**
 * Check if user has a specific permission
 * SEC-010: Role-based authorization
 *
 * @param user - User to check
 * @param permission - Permission name
 * @returns true if user has permission
 */
export function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  const allowedRoles = PERMISSIONS[permission];

  if (!allowedRoles) {
    log.warn('Unknown permission checked', { permission });
    return false;
  }

  return allowedRoles.includes(user.role);
}

/**
 * Check if user has at least the specified role
 * Uses role hierarchy for comparison
 *
 * @param user - User to check
 * @param requiredRole - Minimum required role
 * @returns true if user has required role or higher
 */
export function hasMinimumRole(user: AuthenticatedUser, requiredRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY.indexOf(user.role);
  const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);

  return userLevel >= requiredLevel;
}

/**
 * Get role privilege level
 *
 * @param role - Role to check
 * @returns Numeric level (higher = more privilege)
 */
export function getRoleLevel(role: UserRole): number {
  return ROLE_HIERARCHY.indexOf(role);
}

/**
 * Get list of active users for login selection
 * Returns users without sensitive data (no PIN hash)
 *
 * @returns Array of safe user objects
 */
export function getActiveUsersForLogin(): SafeUser[] {
  const store = storesDAL.getConfiguredStore();
  if (!store) {
    return [];
  }

  const users = usersDAL.findActiveByStore(store.store_id);
  return users.map((u) => UsersDAL.toSafeUser(u));
}
