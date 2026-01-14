/**
 * Store Context
 *
 * Provides store information (including timezone) throughout the application.
 * This context ensures all components have access to the current store's
 * timezone for proper date formatting and display.
 */

import { createContext, useContext, ReactNode } from 'react';

/**
 * Store context value interface
 */
export interface StoreContextValue {
  /** Current store ID (null if no store selected) */
  storeId: string | null;

  /** Store timezone (IANA format, defaults to UTC) */
  timezone: string;

  /** Store name for display */
  storeName: string | null;

  /** Company ID that owns this store */
  companyId: string | null;

  /** Client ID that owns the company */
  clientId: string | null;
}

/**
 * Default context value (UTC fallback)
 */
const defaultContextValue: StoreContextValue = {
  storeId: null,
  timezone: 'UTC',
  storeName: null,
  companyId: null,
  clientId: null,
};

/**
 * Store Context
 */
const StoreContext = createContext<StoreContextValue>(defaultContextValue);

/**
 * Store Provider Props
 */
export interface StoreProviderProps {
  children: ReactNode;
  value: StoreContextValue;
}

/**
 * Store Provider Component
 *
 * Wrap your application or layout with this provider to make store
 * information available to all child components.
 *
 * @example
 * ```tsx
 * <StoreProvider
 *   value={{
 *     storeId: 'store-123',
 *     timezone: 'America/Denver',
 *     storeName: '7-Eleven Downtown',
 *     companyId: 'company-456',
 *     clientId: 'client-789',
 *   }}
 * >
 *   <YourApp />
 * </StoreProvider>
 * ```
 */
export function StoreProvider({ children, value }: StoreProviderProps) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/**
 * Hook to access store context
 *
 * Use this hook in any component to get store information,
 * especially the timezone for date formatting.
 *
 * @returns Store context value
 * @throws Error if used outside StoreProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { timezone, storeName } = useStore();
 *
 *   return (
 *     <div>
 *       <h1>{storeName}</h1>
 *       <p>Timezone: {timezone}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useStore(): StoreContextValue {
  const context = useContext(StoreContext);

  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }

  return context;
}

/**
 * Hook to get just the timezone (convenience hook)
 *
 * @returns Store timezone string
 *
 * @example
 * ```tsx
 * function DateDisplay({ date }: { date: Date }) {
 *   const timezone = useStoreTimezone();
 *   return <span>{formatDateTime(date, timezone)}</span>;
 * }
 * ```
 */
export function useStoreTimezone(): string {
  const { timezone } = useStore();
  return timezone;
}
