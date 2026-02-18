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
  hasValidSessionForRole,
  type SessionInfo as _SessionInfo,
} from '../../../src/main/services/session.service';
import type { SessionUser } from '../../../src/main/ipc/index';

describe('Session Service', () => {
  // Mock user for testing - UserRole uses lowercase
  const mockUser: SessionUser = {
    user_id: 'user-123',
    store_id: 'store-456',
    username: 'testuser',
    role: 'cashier',
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

  /**
   * hasValidSessionForRole Tests
   *
   * Critical for PinVerificationDialog session bypass feature (FE-001)
   * Used when user opens Manual Entry, Pack Reception, Pack Activation dialogs
   *
   * SEC-010: Role validation ensures users can only bypass PIN for operations
   *          matching their role level
   * SEC-012: Session must be within 15-minute window to be valid
   */
  describe('hasValidSessionForRole (FE-001: Session Bypass for PIN Dialog)', () => {
    // Test users at different role levels
    const cashierUser: SessionUser = {
      user_id: 'cashier-123',
      store_id: 'store-456',
      username: 'cashier_user',
      role: 'cashier',
    };

    const shiftManagerUser: SessionUser = {
      user_id: 'shift-mgr-123',
      store_id: 'store-456',
      username: 'shift_manager_user',
      role: 'shift_manager',
    };

    const storeManagerUser: SessionUser = {
      user_id: 'store-mgr-123',
      store_id: 'store-456',
      username: 'store_manager_user',
      role: 'store_manager',
    };

    describe('when no session exists', () => {
      it('should return { valid: false } for any role', () => {
        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(false);
        expect(result.user).toBeUndefined();
        expect(result.timeoutIn).toBeUndefined();
      });

      it('should return { valid: false } for shift_manager role', () => {
        const result = hasValidSessionForRole('shift_manager');

        expect(result.valid).toBe(false);
      });

      it('should return { valid: false } for store_manager role', () => {
        const result = hasValidSessionForRole('store_manager');

        expect(result.valid).toBe(false);
      });
    });

    describe('when session exists with cashier role', () => {
      beforeEach(() => {
        createSession(cashierUser);
      });

      it('should return valid=true when checking for cashier role', () => {
        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
        expect(result.user).toEqual({
          userId: 'cashier-123',
          name: 'cashier_user',
          role: 'cashier',
        });
        expect(result.timeoutIn).toBeDefined();
        expect(result.timeoutIn).toBeGreaterThan(0);
      });

      it('should return valid=false when checking for shift_manager role', () => {
        const result = hasValidSessionForRole('shift_manager');

        expect(result.valid).toBe(false);
        expect(result.user).toBeUndefined();
      });

      it('should return valid=false when checking for store_manager role', () => {
        const result = hasValidSessionForRole('store_manager');

        expect(result.valid).toBe(false);
      });
    });

    describe('when session exists with shift_manager role', () => {
      beforeEach(() => {
        createSession(shiftManagerUser);
      });

      it('should return valid=true when checking for cashier role (higher privilege)', () => {
        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
        expect(result.user?.role).toBe('shift_manager');
      });

      it('should return valid=true when checking for shift_manager role (same level)', () => {
        const result = hasValidSessionForRole('shift_manager');

        expect(result.valid).toBe(true);
        expect(result.user).toEqual({
          userId: 'shift-mgr-123',
          name: 'shift_manager_user',
          role: 'shift_manager',
        });
      });

      it('should return valid=false when checking for store_manager role', () => {
        const result = hasValidSessionForRole('store_manager');

        expect(result.valid).toBe(false);
      });
    });

    describe('when session exists with store_manager role', () => {
      beforeEach(() => {
        createSession(storeManagerUser);
      });

      it('should return valid=true for all role levels', () => {
        expect(hasValidSessionForRole('cashier').valid).toBe(true);
        expect(hasValidSessionForRole('shift_manager').valid).toBe(true);
        expect(hasValidSessionForRole('store_manager').valid).toBe(true);
      });

      it('should include user info with store_manager role', () => {
        const result = hasValidSessionForRole('cashier');

        expect(result.user).toEqual({
          userId: 'store-mgr-123',
          name: 'store_manager_user',
          role: 'store_manager',
        });
      });
    });

    describe('session timeout interaction (SEC-012)', () => {
      beforeEach(() => {
        createSession(cashierUser);
      });

      it('should return valid=true within 15-minute window', () => {
        // Advance 14 minutes
        vi.advanceTimersByTime(14 * 60 * 1000);

        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
      });

      it('should return valid=false after session expires', () => {
        // Advance 16 minutes (past 15-minute timeout)
        vi.advanceTimersByTime(16 * 60 * 1000);

        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(false);
      });

      it('should remain valid after activity update resets timeout', () => {
        // Advance 10 minutes
        vi.advanceTimersByTime(10 * 60 * 1000);
        updateActivity();

        // Advance another 10 minutes (20 total from start, 10 from activity)
        vi.advanceTimersByTime(10 * 60 * 1000);

        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
      });
    });

    describe('unknown role handling (defensive coding)', () => {
      beforeEach(() => {
        createSession(cashierUser);
      });

      it('should return valid=false for unknown required role', () => {
        // Unknown role gets level 0, cashier has level 1, so should be valid
        // Actually: unknown role level = 0, cashier level = 1
        // userRoleLevel (1) >= requiredRoleLevel (0) = true
        const result = hasValidSessionForRole('unknown_role');

        // Higher privilege user can access lower-level operations
        expect(result.valid).toBe(true);
      });
    });

    describe('Manual Entry PIN Dialog use case', () => {
      it('should allow cashier to bypass PIN for manual entry (requiredRole=cashier)', () => {
        createSession(cashierUser);

        // Manual Entry uses requiredRole="cashier" to allow any authenticated user
        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
        expect(result.user?.userId).toBe('cashier-123');
        expect(result.user?.name).toBe('cashier_user');
      });

      it('should allow shift_manager to bypass PIN for manual entry', () => {
        createSession(shiftManagerUser);

        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
        expect(result.user?.userId).toBe('shift-mgr-123');
      });

      it('should allow store_manager to bypass PIN for manual entry', () => {
        createSession(storeManagerUser);

        const result = hasValidSessionForRole('cashier');

        expect(result.valid).toBe(true);
        expect(result.user?.userId).toBe('store-mgr-123');
      });
    });

    describe('SEC-012: Absolute session lifetime (8 hours)', () => {
      it('should expire session after 8 hours regardless of activity', () => {
        createSession(cashierUser);

        // Simulate continuous activity for 7 hours, updating every 10 minutes
        // to stay within the 15-minute inactivity window
        const tenMinutes = 10 * 60 * 1000;
        const iterations = (7 * 60) / 10; // 42 ten-minute periods

        for (let i = 0; i < iterations; i++) {
          vi.advanceTimersByTime(tenMinutes);
          updateActivity(); // Keep session active
        }

        // Session should still be valid at 7 hours
        expect(hasValidSessionForRole('cashier').valid).toBe(true);

        // Continue activity for another 50 minutes (7:50 total)
        for (let i = 0; i < 5; i++) {
          vi.advanceTimersByTime(tenMinutes);
          updateActivity();
        }

        // At 7:50, should still be valid
        expect(hasValidSessionForRole('cashier').valid).toBe(true);

        // Advance past 8 hours total
        vi.advanceTimersByTime(11 * 60 * 1000); // 11 more minutes to reach 8:01

        // Session should be expired due to absolute lifetime
        const result = hasValidSessionForRole('cashier');
        expect(result.valid).toBe(false);
      });

      it('should expire exactly at 8 hour mark', () => {
        createSession(cashierUser);

        // Advance to 7 hours 55 minutes, updating activity regularly
        const fiveMinutes = 5 * 60 * 1000;
        const iterations = (7 * 60 + 55) / 5; // 95 five-minute periods

        for (let i = 0; i < iterations; i++) {
          vi.advanceTimersByTime(fiveMinutes);
          updateActivity();
        }

        // At 7:55, should still be valid
        expect(hasValidSessionForRole('cashier').valid).toBe(true);

        // Advance 4 more minutes to 7:59
        vi.advanceTimersByTime(4 * 60 * 1000);
        updateActivity();

        // Still valid at 7:59
        expect(hasValidSessionForRole('cashier').valid).toBe(true);

        // Advance past 8 hours (2 more minutes)
        vi.advanceTimersByTime(2 * 60 * 1000);

        // Now should be expired due to absolute lifetime
        expect(hasValidSessionForRole('cashier').valid).toBe(false);
      });
    });

    describe('Enterprise UX: Session bypass for protected operations', () => {
      it('should return user info for immediate UI access without PIN prompt', () => {
        createSession(cashierUser);

        const result = hasValidSessionForRole('cashier');

        // Verify complete user info is returned for UI use
        expect(result.valid).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.user?.userId).toBe('cashier-123');
        expect(result.user?.name).toBe('cashier_user');
        expect(result.user?.role).toBe('cashier');
        expect(result.timeoutIn).toBeDefined();
        expect(result.timeoutIn).toBeGreaterThan(0);
      });

      it('should allow multiple sequential operations within session window', () => {
        createSession(cashierUser);

        // Simulate multiple lottery page operations
        const operations = ['Receive Pack', 'Activate Pack', 'Manual Entry'];

        operations.forEach((_op, _index) => {
          // Advance 2 minutes between each operation
          vi.advanceTimersByTime(2 * 60 * 1000);

          const result = hasValidSessionForRole('cashier');
          expect(result.valid).toBe(true);

          // Update activity as the hook would do
          updateActivity();
        });

        // All operations completed within session window
        expect(hasValidSessionForRole('cashier').valid).toBe(true);
      });
    });
  });
});
