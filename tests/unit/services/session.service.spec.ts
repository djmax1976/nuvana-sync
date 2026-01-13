/**
 * Session Service Unit Tests
 *
 * Tests for session management functionality.
 * Validates SEC-012: 15-minute session timeout.
 *
 * @module tests/unit/services/session
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SessionService,
  type Session,
} from '../../../src/main/services/session.service';
import type { SafeUser, UserRole } from '../../../src/main/dal/users.dal';

describe('Session Service', () => {
  let sessionService: SessionService;

  // Mock user for testing
  const mockUser: SafeUser = {
    user_id: 'user-123',
    store_id: 'store-456',
    username: 'testuser',
    role: 'CASHIER' as UserRole,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    sessionService = new SessionService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    sessionService.destroySession();
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('should create a new session with correct properties', () => {
      const session = sessionService.createSession(mockUser);

      expect(session).toBeDefined();
      expect(session.user_id).toBe(mockUser.user_id);
      expect(session.store_id).toBe(mockUser.store_id);
      expect(session.username).toBe(mockUser.username);
      expect(session.role).toBe(mockUser.role);
      expect(session.loginAt).toBeDefined();
      expect(session.lastActivityAt).toBeDefined();
    });

    it('should replace existing session when creating new one', () => {
      sessionService.createSession(mockUser);

      const newUser: SafeUser = { ...mockUser, user_id: 'user-new' };
      const newSession = sessionService.createSession(newUser);

      expect(newSession.user_id).toBe('user-new');
      expect(sessionService.getCurrentSession()?.user_id).toBe('user-new');
    });
  });

  describe('getCurrentSession', () => {
    it('should return null when no session exists', () => {
      expect(sessionService.getCurrentSession()).toBeNull();
    });

    it('should return current session when active', () => {
      sessionService.createSession(mockUser);

      const session = sessionService.getCurrentSession();
      expect(session).not.toBeNull();
      expect(session?.user_id).toBe(mockUser.user_id);
    });
  });

  describe('destroySession', () => {
    it('should remove the current session', () => {
      sessionService.createSession(mockUser);
      expect(sessionService.getCurrentSession()).not.toBeNull();

      sessionService.destroySession();
      expect(sessionService.getCurrentSession()).toBeNull();
    });

    it('should not throw when destroying non-existent session', () => {
      expect(() => sessionService.destroySession()).not.toThrow();
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivityAt timestamp', () => {
      sessionService.createSession(mockUser);
      const initialSession = sessionService.getCurrentSession();
      const initialActivity = initialSession?.lastActivityAt;

      // Advance time by 1 minute
      vi.advanceTimersByTime(60 * 1000);

      sessionService.updateActivity();
      const updatedSession = sessionService.getCurrentSession();

      expect(updatedSession?.lastActivityAt).not.toBe(initialActivity);
    });

    it('should not throw when no session exists', () => {
      expect(() => sessionService.updateActivity()).not.toThrow();
    });
  });

  describe('isExpired (SEC-012: 15-minute timeout)', () => {
    it('should return false for session within 15 minutes', () => {
      sessionService.createSession(mockUser);

      // Advance by 14 minutes
      vi.advanceTimersByTime(14 * 60 * 1000);

      expect(sessionService.isExpired()).toBe(false);
    });

    it('should return true for session after 15 minutes of inactivity', () => {
      sessionService.createSession(mockUser);

      // Advance by 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      expect(sessionService.isExpired()).toBe(true);
    });

    it('should return true when no session exists', () => {
      expect(sessionService.isExpired()).toBe(true);
    });

    it('should reset timeout when activity is updated', () => {
      sessionService.createSession(mockUser);

      // Advance by 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000);
      sessionService.updateActivity();

      // Advance by another 10 minutes (total 20 from start, but only 10 from last activity)
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(sessionService.isExpired()).toBe(false);
    });
  });

  describe('getTimeRemaining', () => {
    it('should return remaining time in milliseconds', () => {
      sessionService.createSession(mockUser);

      // Initially should have close to 15 minutes
      const remaining = sessionService.getTimeRemaining();
      expect(remaining).toBeGreaterThan(14 * 60 * 1000);
      expect(remaining).toBeLessThanOrEqual(15 * 60 * 1000);
    });

    it('should return 0 when session is expired', () => {
      sessionService.createSession(mockUser);

      // Advance by 16 minutes
      vi.advanceTimersByTime(16 * 60 * 1000);

      expect(sessionService.getTimeRemaining()).toBe(0);
    });

    it('should return 0 when no session exists', () => {
      expect(sessionService.getTimeRemaining()).toBe(0);
    });
  });

  describe('isNearExpiry', () => {
    it('should return false when not near expiry', () => {
      sessionService.createSession(mockUser);

      // At 10 minutes, should not be near expiry
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(sessionService.isNearExpiry()).toBe(false);
    });

    it('should return true when within 2 minutes of expiry', () => {
      sessionService.createSession(mockUser);

      // At 14 minutes (1 minute remaining)
      vi.advanceTimersByTime(14 * 60 * 1000);

      expect(sessionService.isNearExpiry()).toBe(true);
    });

    it('should return false when no session exists', () => {
      expect(sessionService.isNearExpiry()).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('should return true for exact role match', () => {
      sessionService.createSession(mockUser);

      expect(sessionService.hasRole('CASHIER')).toBe(true);
    });

    it('should return false for different role', () => {
      sessionService.createSession(mockUser);

      expect(sessionService.hasRole('MANAGER')).toBe(false);
    });

    it('should return false when no session exists', () => {
      expect(sessionService.hasRole('CASHIER')).toBe(false);
    });
  });

  describe('hasMinimumRole', () => {
    it('should allow OWNER access to all roles', () => {
      const ownerUser: SafeUser = { ...mockUser, role: 'OWNER' as UserRole };
      sessionService.createSession(ownerUser);

      expect(sessionService.hasMinimumRole('CASHIER')).toBe(true);
      expect(sessionService.hasMinimumRole('MANAGER')).toBe(true);
      expect(sessionService.hasMinimumRole('OWNER')).toBe(true);
    });

    it('should allow MANAGER access to CASHIER level', () => {
      const managerUser: SafeUser = { ...mockUser, role: 'MANAGER' as UserRole };
      sessionService.createSession(managerUser);

      expect(sessionService.hasMinimumRole('CASHIER')).toBe(true);
      expect(sessionService.hasMinimumRole('MANAGER')).toBe(true);
      expect(sessionService.hasMinimumRole('OWNER')).toBe(false);
    });

    it('should restrict CASHIER to only CASHIER level', () => {
      sessionService.createSession(mockUser); // CASHIER role

      expect(sessionService.hasMinimumRole('CASHIER')).toBe(true);
      expect(sessionService.hasMinimumRole('MANAGER')).toBe(false);
      expect(sessionService.hasMinimumRole('OWNER')).toBe(false);
    });

    it('should return false when no session exists', () => {
      expect(sessionService.hasMinimumRole('CASHIER')).toBe(false);
    });
  });

  describe('getSessionInfo', () => {
    it('should return formatted session info for display', () => {
      sessionService.createSession(mockUser);

      const info = sessionService.getSessionInfo();

      expect(info).toBeDefined();
      expect(info?.username).toBe(mockUser.username);
      expect(info?.role).toBe(mockUser.role);
      expect(info?.loginTime).toBeDefined();
    });

    it('should return null when no session exists', () => {
      expect(sessionService.getSessionInfo()).toBeNull();
    });
  });
});
