/**
 * Session Service Unit Tests
 *
 * Tests for session management functionality.
 * Validates SEC-012: 15-minute session timeout.
 *
 * @module tests/unit/services/session
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock electron before importing session service
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock the IPC module
vi.mock('../../../src/main/ipc/index', () => {
  let currentUser: unknown = null;
  return {
    setCurrentUser: vi.fn((user: unknown) => {
      currentUser = user;
    }),
    getCurrentUser: vi.fn(() => currentUser),
  };
});

// Mock the logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createSession,
  destroySession,
  getSessionInfo,
  getSessionUser,
  updateActivity,
  isSessionExpired,
  hasSession,
  getSessionTimeoutMs,
  forceExpireSession,
  type SessionInfo,
} from '../../../src/main/services/session.service';
import type { SessionUser } from '../../../src/main/ipc/index';

describe('Session Service', () => {
  // Mock user for testing
  const mockUser: SessionUser = {
    user_id: 'user-123',
    store_id: 'store-456',
    username: 'testuser',
    role: 'CASHIER',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // Clean up any existing session
    destroySession();
  });

  afterEach(() => {
    destroySession();
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('should create a new session with correct properties', () => {
      const session = createSession(mockUser);

      expect(session).toBeDefined();
      expect(session.user.user_id).toBe(mockUser.user_id);
      expect(session.user.store_id).toBe(mockUser.store_id);
      expect(session.user.username).toBe(mockUser.username);
      expect(session.user.role).toBe(mockUser.role);
      expect(session.loginAt).toBeDefined();
      expect(session.lastActivityAt).toBeDefined();
      expect(session.timeoutIn).toBe(15 * 60 * 1000); // 15 minutes
    });

    it('should replace existing session when creating new one', () => {
      createSession(mockUser);

      const newUser: SessionUser = { ...mockUser, user_id: 'user-new' };
      const newSession = createSession(newUser);

      expect(newSession.user.user_id).toBe('user-new');
      expect(getSessionUser()?.user_id).toBe('user-new');
    });
  });

  describe('getSessionInfo', () => {
    it('should return null when no session exists', () => {
      expect(getSessionInfo()).toBeNull();
    });

    it('should return current session info when active', () => {
      createSession(mockUser);

      const info = getSessionInfo();
      expect(info).not.toBeNull();
      expect(info?.user.user_id).toBe(mockUser.user_id);
    });
  });

  describe('getSessionUser', () => {
    it('should return null when no session exists', () => {
      expect(getSessionUser()).toBeNull();
    });

    it('should return current user when session active', () => {
      createSession(mockUser);

      const user = getSessionUser();
      expect(user).not.toBeNull();
      expect(user?.user_id).toBe(mockUser.user_id);
    });
  });

  describe('destroySession', () => {
    it('should remove the current session', () => {
      createSession(mockUser);
      expect(getSessionInfo()).not.toBeNull();

      destroySession();
      expect(getSessionInfo()).toBeNull();
    });

    it('should not throw when destroying non-existent session', () => {
      expect(() => destroySession()).not.toThrow();
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivityAt timestamp', () => {
      createSession(mockUser);
      const initialInfo = getSessionInfo();
      const initialActivity = initialInfo?.lastActivityAt;

      // Advance time by 1 minute
      vi.advanceTimersByTime(60 * 1000);

      updateActivity();
      const updatedInfo = getSessionInfo();

      expect(updatedInfo?.lastActivityAt).not.toBe(initialActivity);
    });

    it('should not throw when no session exists', () => {
      expect(() => updateActivity()).not.toThrow();
    });
  });

  describe('isSessionExpired (SEC-012: 15-minute timeout)', () => {
    it('should return false for session within 15 minutes', () => {
      createSession(mockUser);

      // Advance by 14 minutes
      vi.advanceTimersByTime(14 * 60 * 1000);

      expect(isSessionExpired()).toBe(false);
    });

    it('should return true for session after 15 minutes of inactivity', () => {
      createSession(mockUser);

      // Advance by 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      expect(isSessionExpired()).toBe(true);
    });

    it('should return true when no session exists', () => {
      expect(isSessionExpired()).toBe(true);
    });

    it('should reset timeout when activity is updated', () => {
      createSession(mockUser);

      // Advance by 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);
      updateActivity();

      // Advance by another 10 minutes (total 20 from start, but only 10 from last activity)
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(isSessionExpired()).toBe(false);
    });
  });

  describe('hasSession', () => {
    it('should return false when no session exists', () => {
      expect(hasSession()).toBe(false);
    });

    it('should return true when session is active', () => {
      createSession(mockUser);
      expect(hasSession()).toBe(true);
    });

    it('should return false after session expires', () => {
      createSession(mockUser);

      // Advance by 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      expect(hasSession()).toBe(false);
    });
  });

  describe('getSessionTimeoutMs', () => {
    it('should return 15 minutes in milliseconds', () => {
      expect(getSessionTimeoutMs()).toBe(15 * 60 * 1000);
    });
  });

  describe('forceExpireSession', () => {
    it('should destroy an active session', () => {
      createSession(mockUser);
      expect(hasSession()).toBe(true);

      forceExpireSession();
      expect(hasSession()).toBe(false);
    });

    it('should not throw when no session exists', () => {
      expect(() => forceExpireSession()).not.toThrow();
    });
  });
});
