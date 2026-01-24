/**
 * Cashier Session Context
 *
 * Provides cashier session state management for terminal operations.
 * Stores the session token after cashier authentication and makes it
 * available to components that need to make authenticated terminal API calls.
 *
 * Enterprise POS Pattern: Dual-authentication
 * - CLIENT_USER JWT: Web session authentication (handled by ClientAuthContext)
 * - Cashier Session Token: Terminal operations authentication (handled here)
 *
 * Story 4.92: Terminal Shift Page
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

/**
 * Cashier session data stored in context
 */
interface CashierSessionData {
  sessionId: string;
  sessionToken: string;
  cashierId: string;
  cashierName: string;
  terminalId: string;
  expiresAt: string;
}

/**
 * Cashier session context value
 */
interface CashierSessionContextValue {
  /** Current session data, null if no active session */
  session: CashierSessionData | null;
  /** Set session after successful authentication */
  setSession: (data: CashierSessionData) => void;
  /** Clear session (on logout or expiry) */
  clearSession: () => void;
  /** Check if session is expired */
  isSessionExpired: () => boolean;
  /** Get session token for API calls */
  getSessionToken: () => string | null;
}

const CashierSessionContext = createContext<CashierSessionContextValue | null>(null);

// Storage key for persisting session across page reloads
const SESSION_STORAGE_KEY = 'cashier_session';

/**
 * CashierSessionProvider component
 * Wraps terminal pages to provide cashier session context
 */
export function CashierSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<CashierSessionData | null>(null);

  // Load session from sessionStorage on mount (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as CashierSessionData;
          // Check if session is expired
          if (new Date(parsed.expiresAt) > new Date()) {
            // Use queueMicrotask to avoid synchronous setState during effect
            queueMicrotask(() => {
              setSessionState(parsed);
            });
          } else {
            // Clear expired session
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
          }
        } catch {
          // Invalid stored data, clear it
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      }
    }
  }, []);

  const setSession = useCallback((data: CashierSessionData) => {
    setSessionState(data);
    // Persist to sessionStorage for page reloads
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    }
  }, []);

  const clearSession = useCallback(() => {
    setSessionState(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  const isSessionExpired = useCallback(() => {
    if (!session) return true;
    return new Date(session.expiresAt) <= new Date();
  }, [session]);

  const getSessionToken = useCallback(() => {
    if (!session) return null;
    if (isSessionExpired()) {
      clearSession();
      return null;
    }
    return session.sessionToken;
  }, [session, isSessionExpired, clearSession]);

  return (
    <CashierSessionContext.Provider
      value={{
        session,
        setSession,
        clearSession,
        isSessionExpired,
        getSessionToken,
      }}
    >
      {children}
    </CashierSessionContext.Provider>
  );
}

/**
 * Hook to access cashier session context
 * Must be used within CashierSessionProvider
 */
export function useCashierSession() {
  const context = useContext(CashierSessionContext);
  if (!context) {
    throw new Error('useCashierSession must be used within CashierSessionProvider');
  }
  return context;
}

/**
 * Hook to get the current session token
 * Returns null if no session or session expired
 */
export function useCashierSessionToken(): string | null {
  const { getSessionToken } = useCashierSession();
  return getSessionToken();
}
