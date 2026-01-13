/**
 * Session Management Service
 *
 * Manages user sessions with activity-based timeout for the Electron app.
 * Implements SEC-012 session timeout requirements (≤15 minutes).
 *
 * @module main/services/session
 * @security SEC-012: Session expires after 15 minutes of inactivity
 * @security SEC-017: Audit logging for session lifecycle events
 */

import { BrowserWindow } from 'electron';
import { createLogger } from '../utils/logger';
import { setCurrentUser, getCurrentUser, type SessionUser } from '../ipc/index';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended session information with timing metadata
 */
export interface SessionInfo {
  /** User session data */
  user: SessionUser;
  /** When the session was created (ISO 8601) */
  loginAt: string;
  /** Last activity timestamp (ISO 8601) */
  lastActivityAt: string;
  /** Milliseconds until session expires */
  timeoutIn: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * SEC-012: Session timeout after 15 minutes of inactivity
 * POS terminals require shorter timeouts due to shared access
 */
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Warning threshold before session expiry
 * Used to notify user before session times out
 */
const SESSION_WARNING_MS = 2 * 60 * 1000; // 2 minutes before expiry

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('session-service');

// ============================================================================
// Session State
// ============================================================================

/**
 * Internal session state
 * Using module-level singleton pattern matching ipc/index.ts
 */
interface SessionState {
  loginAt: string;
  lastActivityAt: string;
}

let sessionState: SessionState | null = null;
let timeoutTimer: NodeJS.Timeout | null = null;
let warningTimer: NodeJS.Timeout | null = null;

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Clear all session timers
 */
function clearTimers(): void {
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }
}

/**
 * Emit session expired event to all renderer windows
 */
function emitSessionExpired(): void {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('auth:sessionExpired');
    }
  });
  log.info('Session expired event emitted to renderer');
}

/**
 * Emit session warning event to all renderer windows
 */
function emitSessionWarning(): void {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('auth:sessionWarning', {
        expiresIn: SESSION_WARNING_MS,
      });
    }
  });
  log.debug('Session warning event emitted');
}

/**
 * Schedule session timeout
 * SEC-012: Enforces 15-minute inactivity timeout
 */
function scheduleTimeout(): void {
  clearTimers();

  // Schedule warning before timeout
  const warningDelay = SESSION_TIMEOUT_MS - SESSION_WARNING_MS;
  warningTimer = setTimeout(() => {
    emitSessionWarning();
  }, warningDelay);

  // Schedule actual timeout
  timeoutTimer = setTimeout(() => {
    const user = getCurrentUser();
    if (user) {
      log.info('Session expired due to inactivity', {
        userId: user.user_id,
        username: user.username,
        role: user.role,
      });
    }
    destroySession();
    emitSessionExpired();
  }, SESSION_TIMEOUT_MS);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new user session
 * SEC-017: Logs session creation for audit trail
 *
 * @param user - User data for the session
 * @returns Session information
 */
export function createSession(user: SessionUser): SessionInfo {
  const now = new Date().toISOString();

  // Store session state
  sessionState = {
    loginAt: now,
    lastActivityAt: now,
  };

  // Set user in IPC module for handler access
  setCurrentUser(user);

  // Schedule timeout
  scheduleTimeout();

  log.info('Session created', {
    userId: user.user_id,
    username: user.username,
    role: user.role,
    storeId: user.store_id,
  });

  return {
    user,
    loginAt: now,
    lastActivityAt: now,
    timeoutIn: SESSION_TIMEOUT_MS,
  };
}

/**
 * Destroy current session
 * SEC-017: Logs session destruction for audit trail
 */
export function destroySession(): void {
  const user = getCurrentUser();

  clearTimers();
  sessionState = null;
  setCurrentUser(null);

  if (user) {
    log.info('Session destroyed', {
      userId: user.user_id,
      username: user.username,
    });
  }
}

/**
 * Get current session information
 * Returns null if no session or session expired
 *
 * @returns Session info or null
 */
export function getSessionInfo(): SessionInfo | null {
  const user = getCurrentUser();

  if (!user || !sessionState) {
    return null;
  }

  // Calculate time until expiry
  const lastActivity = new Date(sessionState.lastActivityAt).getTime();
  const elapsed = Date.now() - lastActivity;
  const timeoutIn = Math.max(0, SESSION_TIMEOUT_MS - elapsed);

  // SEC-012: Check if session has expired
  if (timeoutIn === 0) {
    log.info('Session expired on access check', {
      userId: user.user_id,
      username: user.username,
    });
    destroySession();
    emitSessionExpired();
    return null;
  }

  return {
    user,
    loginAt: sessionState.loginAt,
    lastActivityAt: sessionState.lastActivityAt,
    timeoutIn,
  };
}

/**
 * Get current user from session
 * Convenience method that checks session validity
 *
 * @returns User or null if no valid session
 */
export function getSessionUser(): SessionUser | null {
  const info = getSessionInfo();
  return info?.user || null;
}

/**
 * Update session activity timestamp
 * Call this on authenticated IPC requests to keep session alive
 * SEC-012: Resets inactivity timer
 */
export function updateActivity(): void {
  if (!sessionState) {
    return;
  }

  sessionState.lastActivityAt = new Date().toISOString();

  // Reschedule timeout from now
  scheduleTimeout();

  log.debug('Session activity updated');
}

/**
 * Check if session is expired
 *
 * @returns true if session is expired or doesn't exist
 */
export function isSessionExpired(): boolean {
  const info = getSessionInfo();
  return info === null;
}

/**
 * Check if session exists
 *
 * @returns true if a valid session exists
 */
export function hasSession(): boolean {
  return getSessionInfo() !== null;
}

/**
 * Get session timeout duration in milliseconds
 * Useful for frontend to display remaining time
 *
 * @returns Timeout duration constant
 */
export function getSessionTimeoutMs(): number {
  return SESSION_TIMEOUT_MS;
}

/**
 * Force session expiration
 * Used for testing or administrative logout
 */
export function forceExpireSession(): void {
  const user = getCurrentUser();
  if (user) {
    log.info('Session force-expired', {
      userId: user.user_id,
      username: user.username,
    });
  }
  destroySession();
  emitSessionExpired();
}
