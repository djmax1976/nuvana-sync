/**
 * Authentication Context
 *
 * Provides authentication state management for the Electron app.
 * Handles PIN-based authentication via IPC to the main process.
 *
 * @module renderer/contexts/AuthContext
 * @security SEC-012: Monitors session expiration events from main process
 * @security SEC-017: Session events logged in main process for audit trail
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * User role levels
 * Matches main process UserRole type
 */
export type UserRole = 'CASHIER' | 'MANAGER' | 'ADMIN';

/**
 * Authenticated user data from main process
 */
export interface AuthUser {
  userId: string;
  name: string;
  role: UserRole;
  storeId: string;
}

/**
 * Session information from main process
 */
export interface SessionInfo {
  loginAt: string;
  lastActivityAt: string;
  timeoutIn: number;
}

/**
 * Login result from main process
 */
interface LoginResponse {
  success: boolean;
  data?: {
    user: AuthUser;
    session: {
      loginAt: string;
      timeoutIn: number;
    };
  };
  error?: string;
}

/**
 * Current user response from main process
 */
interface CurrentUserResponse {
  success: boolean;
  data?: {
    authenticated: boolean;
    user: AuthUser | null;
    session: SessionInfo | null;
  };
  error?: string;
}

/**
 * User list response for login dropdown
 */
interface UsersListResponse {
  success: boolean;
  data?: Array<{
    userId: string;
    name: string;
    role: UserRole;
  }>;
  error?: string;
}

/**
 * Authentication context value
 */
interface AuthContextValue {
  /** Current authenticated user, null if not logged in */
  user: AuthUser | null;
  /** Current session info, null if not logged in */
  session: SessionInfo | null;
  /** Whether authentication is being checked */
  isLoading: boolean;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Login error message if any */
  loginError: string | null;
  /** Login with PIN only (user determined by PIN match) */
  loginByPin: (pin: string) => Promise<boolean>;
  /** Login with specific user ID and PIN */
  loginWithUser: (userId: string, pin: string) => Promise<boolean>;
  /** Logout current user */
  logout: () => Promise<void>;
  /** Get list of users for login selection */
  getUsers: () => Promise<Array<{ userId: string; name: string; role: UserRole }>>;
  /** Check if user has a specific permission */
  hasPermission: (permission: string) => Promise<boolean>;
  /** Check if user has at least the specified role */
  hasMinimumRole: (role: UserRole) => boolean;
  /** Update activity (reset timeout timer) */
  updateActivity: () => Promise<void>;
  /** Clear login error */
  clearLoginError: () => void;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================================
// Role Hierarchy
// ============================================================================

const ROLE_HIERARCHY: UserRole[] = ['CASHIER', 'MANAGER', 'ADMIN'];

// ============================================================================
// Provider
// ============================================================================

/**
 * AuthProvider component
 * Provides authentication context to the app
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await window.electronAPI.invoke<CurrentUserResponse>(
          'auth:getCurrentUser'
        );

        if (response.success && response.data?.authenticated && response.data.user) {
          setUser(response.data.user);
          setSession(response.data.session);
        } else {
          setUser(null);
          setSession(null);
        }
      } catch (error) {
        console.error('[AuthContext] Failed to check auth status:', error);
        setUser(null);
        setSession(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Listen for session expiration from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.on('auth:sessionExpired', () => {
      console.log('[AuthContext] Session expired, clearing user');
      setUser(null);
      setSession(null);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for session warning (2 minutes before expiry)
  useEffect(() => {
    const unsubscribe = window.electronAPI.on('auth:sessionWarning', () => {
      console.log('[AuthContext] Session warning: expiring soon');
      // Could show a toast/modal here to warn user
    });

    return () => {
      unsubscribe();
    };
  }, []);

  /**
   * Login with PIN only
   * User is determined by matching PIN against all active users
   */
  const loginByPin = useCallback(async (pin: string): Promise<boolean> => {
    setLoginError(null);
    setIsLoading(true);

    try {
      const response = await window.electronAPI.invoke<LoginResponse>(
        'auth:login',
        { pin }
      );

      if (response.success && response.data) {
        setUser(response.data.user);
        setSession({
          loginAt: response.data.session.loginAt,
          lastActivityAt: response.data.session.loginAt,
          timeoutIn: response.data.session.timeoutIn,
        });
        return true;
      } else {
        setLoginError(response.error || 'Authentication failed');
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      setLoginError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Login with specific user ID and PIN
   */
  const loginWithUser = useCallback(
    async (userId: string, pin: string): Promise<boolean> => {
      setLoginError(null);
      setIsLoading(true);

      try {
        const response = await window.electronAPI.invoke<LoginResponse>(
          'auth:loginWithUser',
          { userId, pin }
        );

        if (response.success && response.data) {
          setUser(response.data.user);
          setSession({
            loginAt: response.data.session.loginAt,
            lastActivityAt: response.data.session.loginAt,
            timeoutIn: response.data.session.timeoutIn,
          });
          return true;
        } else {
          setLoginError(response.error || 'Authentication failed');
          return false;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        setLoginError(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * Logout current user
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await window.electronAPI.invoke('auth:logout');
    } catch (error) {
      console.error('[AuthContext] Logout error:', error);
    } finally {
      setUser(null);
      setSession(null);
      setLoginError(null);
    }
  }, []);

  /**
   * Get list of users for login selection
   */
  const getUsers = useCallback(async (): Promise<
    Array<{ userId: string; name: string; role: UserRole }>
  > => {
    try {
      const response = await window.electronAPI.invoke<UsersListResponse>('auth:getUsers');

      if (response.success && response.data) {
        return response.data;
      }
      return [];
    } catch (error) {
      console.error('[AuthContext] Failed to get users:', error);
      return [];
    }
  }, []);

  /**
   * Check if user has a specific permission
   */
  const hasPermission = useCallback(async (permission: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const response = await window.electronAPI.invoke<{
        success: boolean;
        data?: { hasPermission: boolean };
      }>('auth:hasPermission', { permission });

      return response.success && response.data?.hasPermission === true;
    } catch (error) {
      console.error('[AuthContext] Permission check error:', error);
      return false;
    }
  }, [user]);

  /**
   * Check if user has at least the specified role
   * Uses local role hierarchy (no IPC needed)
   */
  const hasMinimumRole = useCallback(
    (requiredRole: UserRole): boolean => {
      if (!user) return false;

      const userLevel = ROLE_HIERARCHY.indexOf(user.role);
      const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);

      return userLevel >= requiredLevel;
    },
    [user]
  );

  /**
   * Update activity to keep session alive
   */
  const updateActivity = useCallback(async (): Promise<void> => {
    if (!user) return;

    try {
      await window.electronAPI.invoke('auth:updateActivity');
      // Update local session timestamp
      setSession((prev) =>
        prev
          ? {
              ...prev,
              lastActivityAt: new Date().toISOString(),
            }
          : null
      );
    } catch (error) {
      console.error('[AuthContext] Update activity error:', error);
    }
  }, [user]);

  /**
   * Clear login error
   */
  const clearLoginError = useCallback(() => {
    setLoginError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: user !== null,
        loginError,
        loginByPin,
        loginWithUser,
        logout,
        getUsers,
        hasPermission,
        hasMinimumRole,
        updateActivity,
        clearLoginError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access authentication context
 * Must be used within AuthProvider
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/**
 * Hook to get the current authenticated user
 * Returns null if not authenticated
 */
export function useAuthUser(): AuthUser | null {
  const { user } = useAuth();
  return user;
}

/**
 * Hook to check if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useAuth();
  return isAuthenticated;
}

/**
 * Hook to require authentication
 * Returns user or throws if not authenticated
 */
export function useRequireAuth(): AuthUser {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated || !user) {
    throw new Error('User must be authenticated');
  }
  return user;
}
