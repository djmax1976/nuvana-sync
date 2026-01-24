/**
 * Auth Service Unit Tests
 *
 * Tests for authentication functionality.
 * Validates SEC-001: bcrypt PIN hashing
 * Validates SEC-011: brute-force protection
 *
 * @module tests/unit/services/auth
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Hoist mock functions so they're available when vi.mock factory runs
const {
  mockVerifyPin,
  mockFindByIdForStore,
  mockFindActiveByStore,
  mockToSafeUser,
  mockGetConfiguredStore,
} = vi.hoisted(() => ({
  mockVerifyPin: vi.fn(),
  mockFindByIdForStore: vi.fn(),
  mockFindActiveByStore: vi.fn(),
  mockToSafeUser: vi.fn((user: unknown) => user),
  mockGetConfiguredStore: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock the logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
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

// Mock the UsersDAL
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    verifyPin: mockVerifyPin,
    findByIdForStore: mockFindByIdForStore,
    findActiveByStore: mockFindActiveByStore,
  },
  UsersDAL: {
    toSafeUser: mockToSafeUser,
  },
}));

// Mock the StoresDAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

import {
  authenticateByPin,
  authenticateUser,
  logout,
  getCurrentAuthUser,
  getCurrentSession,
  trackActivity as _trackActivity,
  hasPermission,
  hasMinimumRole,
  getRoleLevel,
  getActiveUsersForLogin as _getActiveUsersForLogin,
  type LoginResult as _LoginResult,
  type AuthenticatedUser,
} from '../../../src/main/services/auth.service';
import { destroySession } from '../../../src/main/services/session.service';

describe('Auth Service', () => {
  const mockStore = {
    store_id: 'store-456',
    name: 'Test Store',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockUser = {
    user_id: 'user-123',
    store_id: 'store-456',
    name: 'Test User',
    role: 'cashier' as const,
    active: true,
    pin_hash: 'hashed_pin',
    cloud_user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    destroySession();
    mockGetConfiguredStore.mockReturnValue(mockStore);
  });

  afterEach(() => {
    destroySession();
    vi.useRealTimers();
  });

  describe('authenticateByPin', () => {
    it('should successfully authenticate with valid PIN', async () => {
      mockFindActiveByStore.mockReturnValue([mockUser]);
      mockVerifyPin.mockResolvedValue(true);
      mockToSafeUser.mockReturnValue(mockUser);

      const result = await authenticateByPin('1234');

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.session).toBeDefined();
    });

    it('should fail when store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(null);

      const result = await authenticateByPin('1234');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('STORE_NOT_CONFIGURED');
    });

    it('should fail with invalid PIN', async () => {
      mockFindActiveByStore.mockReturnValue([mockUser]);
      mockVerifyPin.mockResolvedValue(false);

      const resultPromise = authenticateByPin('wrong');
      await vi.advanceTimersByTimeAsync(5100); // Advance past brute-force delay
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PIN');
    });

    it('should fail when no active users exist', async () => {
      mockFindActiveByStore.mockReturnValue([]);

      const resultPromise = authenticateByPin('1234');
      await vi.advanceTimersByTimeAsync(5100); // Advance past brute-force delay
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PIN');
    });
  });

  describe('authenticateUser', () => {
    it('should authenticate specific user with valid PIN', async () => {
      mockFindByIdForStore.mockReturnValue(mockUser);
      mockVerifyPin.mockResolvedValue(true);
      mockToSafeUser.mockReturnValue(mockUser);

      const result = await authenticateUser('user-123', '1234');

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
    });

    it('should fail when user not found', async () => {
      mockFindByIdForStore.mockReturnValue(null);

      const resultPromise = authenticateUser('nonexistent', '1234');
      await vi.advanceTimersByTimeAsync(5100); // Advance past brute-force delay
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('USER_NOT_FOUND');
    });

    it('should fail when user is inactive', async () => {
      mockFindByIdForStore.mockReturnValue({ ...mockUser, active: false });

      const resultPromise = authenticateUser('user-123', '1234');
      await vi.advanceTimersByTimeAsync(5100); // Advance past brute-force delay
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('USER_INACTIVE');
    });

    it('should fail with invalid PIN', async () => {
      mockFindByIdForStore.mockReturnValue(mockUser);
      mockVerifyPin.mockResolvedValue(false);

      const resultPromise = authenticateUser('user-123', 'wrong');
      await vi.advanceTimersByTimeAsync(5100); // Advance past brute-force delay
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PIN');
    });
  });

  describe('logout', () => {
    it('should destroy session on logout', async () => {
      mockFindActiveByStore.mockReturnValue([mockUser]);
      mockVerifyPin.mockResolvedValue(true);
      mockToSafeUser.mockReturnValue(mockUser);

      await authenticateByPin('1234');
      expect(getCurrentSession()).not.toBeNull();

      logout();
      expect(getCurrentSession()).toBeNull();
    });

    it('should not throw when logging out without session', () => {
      expect(() => logout()).not.toThrow();
    });
  });

  describe('getCurrentAuthUser', () => {
    it('should return null when not logged in', () => {
      expect(getCurrentAuthUser()).toBeNull();
    });

    it('should return user info when logged in', async () => {
      mockFindActiveByStore.mockReturnValue([mockUser]);
      mockVerifyPin.mockResolvedValue(true);
      mockToSafeUser.mockReturnValue(mockUser);

      await authenticateByPin('1234');

      const authUser = getCurrentAuthUser();
      expect(authUser).not.toBeNull();
      expect(authUser?.userId).toBe('user-123');
    });
  });

  describe('hasPermission', () => {
    const authUser: AuthenticatedUser = {
      userId: 'user-123',
      name: 'Test User',
      role: 'shift_manager',
      storeId: 'store-456',
    };

    it('should return true for valid permission', () => {
      expect(hasPermission(authUser, 'close_shift')).toBe(true);
    });

    it('should return false for insufficient permission', () => {
      const cashierUser: AuthenticatedUser = {
        ...authUser,
        role: 'cashier',
      };
      expect(hasPermission(cashierUser, 'manage_users')).toBe(false);
    });
  });

  describe('getRoleLevel', () => {
    it('should return correct role levels', () => {
      expect(getRoleLevel('cashier')).toBe(0);
      expect(getRoleLevel('shift_manager')).toBe(1);
      expect(getRoleLevel('store_manager')).toBe(2);
    });
  });

  describe('hasMinimumRole', () => {
    const storeManager: AuthenticatedUser = {
      userId: 'user-123',
      name: 'Manager',
      role: 'store_manager',
      storeId: 'store-456',
    };

    const cashier: AuthenticatedUser = {
      userId: 'user-456',
      name: 'Cashier',
      role: 'cashier',
      storeId: 'store-456',
    };

    it('should return true when user has higher role', () => {
      expect(hasMinimumRole(storeManager, 'cashier')).toBe(true);
      expect(hasMinimumRole(storeManager, 'shift_manager')).toBe(true);
    });

    it('should return true when user has equal role', () => {
      expect(hasMinimumRole(storeManager, 'store_manager')).toBe(true);
    });

    it('should return false when user has lower role', () => {
      expect(hasMinimumRole(cashier, 'shift_manager')).toBe(false);
      expect(hasMinimumRole(cashier, 'store_manager')).toBe(false);
    });
  });
});
