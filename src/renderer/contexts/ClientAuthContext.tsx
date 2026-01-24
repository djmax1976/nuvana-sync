import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Client user interface with is_client_user flag and user_role
 */
interface ClientUser {
  id: string;
  email: string;
  name: string;
  is_client_user: boolean;
  user_role?: string;
  roles?: string[];
}

/**
 * Client auth context type
 */
interface ClientAuthContextType {
  user: ClientUser | null;
  permissions: string[];
  isLoading: boolean;
  isAuthenticated: boolean;
  isClientUser: boolean;
  isStoreUser: boolean; // True if user should access /mystore (store-level roles)
  userRole: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const ClientAuthContext = createContext<ClientAuthContextType | undefined>(undefined);

const STORAGE_KEY = 'auth_session';

/**
 * Client Auth Provider
 * Provides authentication context specifically for client users
 * Uses unified POST /api/auth/login endpoint (role-based routing)
 */
export function ClientAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const backendUrl = 'http://localhost:3001';

  // Validate session with backend on mount
  useEffect(() => {
    const validateSession = async () => {
      try {
        setIsLoading(true);

        // Check localStorage first for quick initial state
        // Clear legacy key if present to prevent conflicts
        try {
          localStorage.removeItem('client_auth_session');
        } catch (storageError) {
          // Non-fatal: failed to clear legacy key
        }

        let authSession: string | null = null;
        try {
          authSession = localStorage.getItem(STORAGE_KEY);
        } catch (storageError) {
          // localStorage access failed (e.g., private browsing, storage disabled)
          console.warn(
            'Failed to access localStorage for auth session:',
            storageError instanceof Error ? storageError.message : 'Unknown error'
          );
          setIsLoading(false);
          return;
        }

        if (!authSession) {
          setIsLoading(false);
          return;
        }

        let timeout: NodeJS.Timeout | undefined;
        try {
          const data = JSON.parse(authSession);
          if (!data.authenticated || !data.user) {
            try {
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem('client_auth_session');
            } catch (storageError) {
              // Non-fatal: failed to remove invalid session
              console.warn(
                'Failed to remove invalid session from localStorage:',
                storageError instanceof Error ? storageError.message : 'Unknown error'
              );
            }
            setIsLoading(false);
            return;
          }

          // Check if user is a client user from stored payload or validate
          const isClientUserFromStorage = data.isClientUser === true;
          if (!isClientUserFromStorage) {
            // Not a client user - clear session and return
            try {
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem('client_auth_session');
            } catch (storageError) {
              // Non-fatal: failed to remove session
            }
            setIsLoading(false);
            return;
          }

          // CRITICAL: Validate JWT tokens with backend server
          // This prevents dashboard render with expired/invalid tokens
          const controller = new AbortController();
          timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

          const response = await fetch(`${backendUrl}/api/auth/me`, {
            method: 'GET',
            credentials: 'include', // Send httpOnly cookies
            signal: controller.signal,
          });

          // Clear timeout on successful response
          clearTimeout(timeout);

          if (response.ok) {
            const validatedData = await response.json();

            // Store-level roles that should access /mystore
            const storeRoles = ['CLIENT_USER', 'STORE_MANAGER', 'SHIFT_MANAGER', 'CASHIER'];

            // Check if user has store-level access (for /mystore dashboard)
            // Only store-level roles should access /mystore
            const isStoreUser = validatedData.user.roles?.some((r: string) =>
              storeRoles.includes(r)
            );

            // Check if user is CLIENT_OWNER or SUPPORT (for /client-dashboard)
            // SUPPORT has COMPANY scope like CLIENT_OWNER - can access company and all stores
            const isClientOwner = validatedData.user.roles?.includes('CLIENT_OWNER');
            const isSupportUser = validatedData.user.roles?.includes('SUPPORT');

            // Check if user has any client access (including CLIENT_OWNER and SUPPORT)
            const hasClientAccess =
              validatedData.user.permissions?.includes('CLIENT_DASHBOARD_ACCESS') ||
              validatedData.user.roles?.some(
                (r: string) =>
                  r === 'CLIENT_USER' ||
                  r === 'CLIENT_OWNER' ||
                  r === 'SUPPORT' ||
                  r === 'STORE_MANAGER' ||
                  r === 'SHIFT_MANAGER' ||
                  r === 'CASHIER'
              );

            // Allow store-level users, CLIENT_OWNER, and SUPPORT to be authenticated
            // The layouts will handle routing to the correct dashboard
            if (!isStoreUser && !isClientOwner && !isSupportUser) {
              // User doesn't have client access at all - clear session
              try {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem('client_auth_session');
              } catch (storageError) {
                // Non-fatal: failed to clear session
              }
              setUser(null);
              setPermissions([]);
              setIsLoading(false);
              return;
            }

            // Determine user_role for routing
            // Priority: CLIENT_OWNER > SUPPORT > Store-level roles
            let userRole: string | undefined;
            const roles = validatedData.user.roles || [];
            if (roles.includes('CLIENT_OWNER')) {
              userRole = 'CLIENT_OWNER';
            } else if (roles.includes('SUPPORT')) {
              userRole = 'SUPPORT';
            } else if (roles.includes('CLIENT_USER')) {
              userRole = 'CLIENT_USER';
            } else if (roles.includes('STORE_MANAGER')) {
              userRole = 'STORE_MANAGER';
            } else if (roles.includes('SHIFT_MANAGER')) {
              userRole = 'SHIFT_MANAGER';
            } else if (roles.includes('CASHIER')) {
              userRole = 'CASHIER';
            }

            const userData: ClientUser = {
              id: validatedData.user.id,
              email: validatedData.user.email,
              name: validatedData.user.name || validatedData.user.email,
              is_client_user: hasClientAccess,
              user_role: userRole,
              roles: roles,
            };

            // Store permissions from validated data
            setPermissions(validatedData.user.permissions || []);

            // Update localStorage with validated user data
            // Clear legacy key to prevent conflicts
            try {
              localStorage.removeItem('client_auth_session');
              localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                  user: userData,
                  authenticated: true,
                  isClientUser: hasClientAccess,
                  isStoreUser: isStoreUser,
                  userRole: userRole,
                })
              );
            } catch (storageError) {
              // Non-fatal: failed to save session, but user is still authenticated
              console.warn(
                'Failed to save validated session to localStorage:',
                storageError instanceof Error ? storageError.message : 'Unknown error'
              );
            }

            setUser(userData);
          } else {
            // Token invalid or expired - clear localStorage and stay logged out
            try {
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem('client_auth_session');
            } catch (storageError) {
              // Non-fatal: failed to clear expired session
              console.warn(
                'Failed to clear expired session from localStorage:',
                storageError instanceof Error ? storageError.message : 'Unknown error'
              );
            }
            setUser(null);
            setPermissions([]);
          }
        } catch (error) {
          // Clear timeout in case of error (if it was set)
          if (timeout) {
            clearTimeout(timeout);
          }

          // Handle AbortError (timeout) specifically
          if (error instanceof Error && error.name === 'AbortError') {
            console.warn('Session validation request timed out after 5 seconds');
            // Treat timeout as invalid session - clear and stay logged out
          } else {
            // JSON parse error or other processing error
            console.warn(
              'Error during session validation:',
              error instanceof Error ? error.message : 'Unknown error'
            );
          }

          try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem('client_auth_session');
          } catch (storageError) {
            // Non-fatal: failed to remove corrupted session
            console.warn(
              'Failed to remove corrupted session from localStorage:',
              storageError instanceof Error ? storageError.message : 'Unknown error'
            );
          }
          setUser(null);
          setPermissions([]);
        }
      } catch (error) {
        // Catch any unexpected errors to prevent propagation
        console.warn(
          'Unexpected error during session validation:',
          error instanceof Error ? error.message : 'Unknown error'
        );
        setUser(null);
        setPermissions([]);
      } finally {
        setIsLoading(false);
      }
    };

    validateSession();
  }, [backendUrl]);

  /**
   * Logout - clear session and redirect to unified login
   */
  const logout = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(`${backendUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
      });

      // Clear timeout on success
      clearTimeout(timeoutId);

      // Check response status - treat non-2xx as errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Logout failed with status ${response.status}`);
      }
    } catch (error) {
      // Clear timeout in case of error
      clearTimeout(timeoutId);

      // Handle AbortError (timeout) specifically
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Logout request timed out after 5 seconds');
        // Proceed with local logout as fallback
      } else if (error instanceof Error) {
        console.error('Logout error:', error.message);
        // Proceed with local logout as fallback
      } else {
        console.error('Logout error: Unknown error occurred');
        // Proceed with local logout as fallback
      }
    }

    // Clear state regardless of backend success (safe fallback)
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('client_auth_session');
    } catch (storageError) {
      // Non-fatal: failed to clear session from localStorage
      // Log error but continue with logout cleanup
      console.warn(
        'Failed to clear session from localStorage:',
        storageError instanceof Error ? storageError.message : 'Unknown error'
      );
    } finally {
      // Always execute cleanup regardless of storage errors
      setUser(null);
      setPermissions([]);
      navigate('/login');
    }
  }, [backendUrl]);

  // Proactive token refresh to keep users logged in during active sessions
  // Refreshes access token every 10 minutes (before 15-minute expiry)
  useEffect(() => {
    if (!user) {
      return; // Only run when user is authenticated
    }

    const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

    const refreshInterval = setInterval(async () => {
      const controller = new AbortController();
      const REFRESH_TIMEOUT = 5000; // 5 seconds timeout (configurable)
      const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT);

      try {
        const response = await fetch(`${backendUrl}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // Send refresh token cookie
          signal: controller.signal,
        });

        // Clear timeout on success
        clearTimeout(timeoutId);

        if (!response.ok) {
          // Token refresh failed - session is expired, logout user
          await logout();
        }
      } catch (error) {
        // Clear timeout in case of error
        clearTimeout(timeoutId);

        // Handle AbortError (timeout) - treat as failed refresh
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('Token refresh request timed out after 5 seconds');
          // Treat timeout as failed refresh - logout to prevent stale tokens
          await logout();
        } else {
          // Network error or backend unavailable - logout for security
          await logout();
        }
      }
    }, REFRESH_INTERVAL);

    // Cleanup interval on unmount or when user logs out
    return () => clearInterval(refreshInterval);
  }, [user, backendUrl, logout]);

  /**
   * Client login - uses unified /api/auth/login endpoint
   * Verifies that the user is a client user after authentication
   */
  const login = async (email: string, password: string) => {
    const response = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Login failed');
    }

    // Verify the user has client access
    const isClientUser = data.user?.is_client_user === true;
    if (!isClientUser) {
      // User is not a client user - logout and show error
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      try {
        const response = await fetch(`${backendUrl}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        });

        // Clear timeout on success
        clearTimeout(timeoutId);

        // Check response status - treat non-2xx as errors
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(
            `Logout failed with status ${response.status}:`,
            errorData.message || 'Unknown error'
          );
          // Continue with error throw even if logout fails
        }
      } catch (error) {
        // Clear timeout in case of error
        clearTimeout(timeoutId);

        // Handle AbortError (timeout) specifically
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('Logout request timed out after 5 seconds');
          // Continue with error throw even if logout times out
        } else if (error instanceof Error) {
          console.error('Logout error:', error.message);
          // Continue with error throw even if logout fails
        } else {
          console.error('Logout error: Unknown error occurred');
          // Continue with error throw even if logout fails
        }
      }

      throw new Error('This account does not have client portal access');
    }

    // Determine user_role for routing (same logic as initial validation)
    // Priority: CLIENT_OWNER > SUPPORT > Store-level roles
    const roles = data.user?.roles || [];
    let userRole: string | undefined;
    if (roles.includes('CLIENT_OWNER')) {
      userRole = 'CLIENT_OWNER';
    } else if (roles.includes('SUPPORT')) {
      userRole = 'SUPPORT';
    } else if (roles.includes('CLIENT_USER')) {
      userRole = 'CLIENT_USER';
    } else if (roles.includes('STORE_MANAGER')) {
      userRole = 'STORE_MANAGER';
    } else if (roles.includes('SHIFT_MANAGER')) {
      userRole = 'SHIFT_MANAGER';
    } else if (roles.includes('CASHIER')) {
      userRole = 'CASHIER';
    }

    // Determine if this is a store-level user (for /mystore routing)
    // SUPPORT is NOT a store-level user - has COMPANY scope like CLIENT_OWNER
    const isStoreUser =
      roles.includes('CLIENT_USER') ||
      roles.includes('STORE_MANAGER') ||
      roles.includes('SHIFT_MANAGER') ||
      roles.includes('CASHIER');

    const userData: ClientUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name || data.user.email,
      is_client_user: true,
      user_role: userRole,
      roles: roles,
    };

    // Store permissions from login response
    setPermissions(data.user.permissions || []);

    // Store user info - clear legacy key to prevent conflicts
    // Include userRole and isStoreUser for LoginForm routing
    try {
      localStorage.removeItem('client_auth_session');
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          user: userData,
          authenticated: true,
          isClientUser: true,
          isStoreUser: isStoreUser,
          userRole: userRole,
        })
      );
    } catch (storageError) {
      // Non-fatal: failed to save session, but user is still authenticated
      console.warn(
        'Failed to save login session to localStorage:',
        storageError instanceof Error ? storageError.message : 'Unknown error'
      );
      // Continue with authentication even if storage fails
    }

    setUser(userData);
  };

  /**
   * Refresh user data from backend
   */
  const refreshUser = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(`${backendUrl}/api/auth/me`, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });

      // Clear timeout on successful response
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();

        // SEC-010: AUTHZ - Trust the backend's authentication response
        // The backend has already validated the user's session and permissions
        // We simply update the context with the validated data
        // This is role-agnostic and will work with any current or future roles
        const roles = data.user.roles || [];

        // Determine user_role for routing (priority order)
        // Priority: CLIENT_OWNER > SUPPORT > Store-level roles > SUPERADMIN
        let userRole: string | undefined;
        if (roles.includes('CLIENT_OWNER')) {
          userRole = 'CLIENT_OWNER';
        } else if (roles.includes('SUPPORT')) {
          userRole = 'SUPPORT';
        } else if (roles.includes('CLIENT_USER')) {
          userRole = 'CLIENT_USER';
        } else if (roles.includes('STORE_MANAGER')) {
          userRole = 'STORE_MANAGER';
        } else if (roles.includes('SHIFT_MANAGER')) {
          userRole = 'SHIFT_MANAGER';
        } else if (roles.includes('CASHIER')) {
          userRole = 'CASHIER';
        } else if (roles.includes('SUPERADMIN')) {
          userRole = 'SUPERADMIN';
        } else if (roles.length > 0) {
          // Future-proof: use first role if none of the known ones match
          userRole = roles[0];
        }

        const userData: ClientUser = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name || data.user.email,
          is_client_user: data.user.is_client_user ?? true, // Trust backend's determination
          user_role: userRole,
          roles: roles,
        };

        // Store permissions from validated data
        setPermissions(data.user.permissions || []);

        // Clear legacy key to prevent conflicts
        try {
          localStorage.removeItem('client_auth_session');
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              user: userData,
              authenticated: true,
              isClientUser: userData.is_client_user,
              userRole: userRole,
            })
          );
        } catch (storageError) {
          console.error(
            `Failed to save user session to localStorage: ${storageError instanceof Error ? storageError.message : String(storageError)}`
          );
        }

        setUser(userData);
      } else {
        // Token invalid or expired
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem('client_auth_session');
        } catch (storageError) {
          console.error(
            `Failed to remove expired session from localStorage: ${storageError instanceof Error ? storageError.message : String(storageError)}`
          );
        }
        setUser(null);
        setPermissions([]);
      }
    } catch (error) {
      // Clear timeout in case of error
      clearTimeout(timeoutId);

      // Handle AbortError (timeout) - treat as refresh failure
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Refresh user request timed out after 5 seconds');
      } else {
        console.error('Failed to refresh user:', error);
      }

      // Remove STORAGE_KEY and setUser(null) on error (including abort)
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('client_auth_session');
      } catch (storageError) {
        console.error(
          `Failed to remove session from localStorage on error: ${storageError instanceof Error ? storageError.message : String(storageError)}`
        );
      }
      setUser(null);
      setPermissions([]);
    }
  }, [backendUrl, setUser]);

  // Determine if user is a store-level user (should access /mystore)
  const storeRoles = ['CLIENT_USER', 'STORE_MANAGER', 'SHIFT_MANAGER', 'CASHIER'];
  const isStoreUser = user?.roles?.some((r) => storeRoles.includes(r)) ?? false;

  return (
    <ClientAuthContext.Provider
      value={{
        user,
        permissions: permissions ?? [],
        isLoading,
        isAuthenticated: !!user,
        isClientUser: user?.is_client_user ?? false,
        isStoreUser,
        userRole: user?.user_role ?? null,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </ClientAuthContext.Provider>
  );
}

/**
 * Hook to use client auth context
 * Throws error if used outside of ClientAuthProvider
 * Ensures permissions is always an array (never null/undefined)
 */
export function useClientAuth() {
  const context = useContext(ClientAuthContext);
  if (context === undefined) {
    throw new Error('useClientAuth must be used within a ClientAuthProvider');
  }
  // Defensive: ensure permissions is always an array
  return {
    ...context,
    permissions: context.permissions ?? [],
  };
}
