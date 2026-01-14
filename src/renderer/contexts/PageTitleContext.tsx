/**
 * Page Title Context
 *
 * Provides centralized page title state management for the client dashboard layout.
 * This context allows child pages to set their title, which is then displayed
 * in the header bar instead of within the page content area.
 *
 * @module contexts/PageTitleContext
 *
 * Security Considerations (FE-001: STATE_MANAGEMENT):
 * - Page titles are non-sensitive UI state only
 * - No tokens or secrets are stored in this context
 * - State is encapsulated in a dedicated module with clear documentation
 *
 * Performance Considerations (FE-020: REACT_OPTIMIZATION):
 * - Context value is memoized to prevent unnecessary re-renders
 * - Separate contexts for state and dispatch to optimize consumer re-renders
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';

/**
 * Page title state interface
 * Contains the current page title to display in the header
 */
export interface PageTitleState {
  /** Current page title (null if not set) */
  title: string | null;
}

/**
 * Page title dispatch interface
 * Contains the function to update the page title
 */
export interface PageTitleDispatch {
  /** Set the current page title */
  setPageTitle: (title: string | null) => void;
}

/**
 * Default state value
 */
const defaultState: PageTitleState = {
  title: null,
};

/**
 * Page Title State Context
 * Provides read-only access to the current page title
 */
const PageTitleStateContext = createContext<PageTitleState | undefined>(undefined);
PageTitleStateContext.displayName = 'PageTitleStateContext';

/**
 * Page Title Dispatch Context
 * Provides the setter function for updating page title
 * Separated from state to prevent re-renders in components that only set title
 */
const PageTitleDispatchContext = createContext<PageTitleDispatch | undefined>(undefined);
PageTitleDispatchContext.displayName = 'PageTitleDispatchContext';

/**
 * Page Title Provider Props
 */
export interface PageTitleProviderProps {
  /** Child components that will have access to page title context */
  children: ReactNode;
}

/**
 * Page Title Provider Component
 *
 * Wrap your layout with this provider to enable page title management.
 * Child pages can set their title using the useSetPageTitle hook,
 * and the header can read the title using the usePageTitle hook.
 *
 * @example
 * ```tsx
 * // In layout component
 * <PageTitleProvider>
 *   <Header />
 *   <main>{children}</main>
 * </PageTitleProvider>
 * ```
 */
export function PageTitleProvider({ children }: PageTitleProviderProps) {
  const [title, setTitle] = useState<string | null>(null);

  // Memoize the setter to prevent unnecessary re-renders (FE-020: REACT_OPTIMIZATION)
  const setPageTitle = useCallback((newTitle: string | null) => {
    setTitle(newTitle);
  }, []);

  // Memoize state value to prevent unnecessary re-renders
  const stateValue = useMemo<PageTitleState>(
    () => ({
      title,
    }),
    [title]
  );

  // Memoize dispatch value to maintain referential stability
  const dispatchValue = useMemo<PageTitleDispatch>(
    () => ({
      setPageTitle,
    }),
    [setPageTitle]
  );

  return (
    <PageTitleStateContext.Provider value={stateValue}>
      <PageTitleDispatchContext.Provider value={dispatchValue}>
        {children}
      </PageTitleDispatchContext.Provider>
    </PageTitleStateContext.Provider>
  );
}

/**
 * Hook to read the current page title
 *
 * Use this hook in the header component to display the current page title.
 *
 * @returns Current page title state
 * @throws Error if used outside PageTitleProvider
 *
 * @example
 * ```tsx
 * function Header() {
 *   const { title } = usePageTitle();
 *   return (
 *     <header>
 *       <h1>{title}</h1>
 *     </header>
 *   );
 * }
 * ```
 */
export function usePageTitle(): PageTitleState {
  const context = useContext(PageTitleStateContext);

  if (context === undefined) {
    throw new Error('usePageTitle must be used within a PageTitleProvider');
  }

  return context;
}

/**
 * Safe hook to read the current page title
 *
 * Use this hook in components that may be rendered outside of a PageTitleProvider.
 * Returns null for the title if the provider is not available, instead of throwing.
 *
 * @returns Current page title state, or default state if outside provider
 *
 * @example
 * ```tsx
 * function Header() {
 *   const { title } = usePageTitleSafe();
 *   return (
 *     <header>
 *       {title && <h1>{title}</h1>}
 *     </header>
 *   );
 * }
 * ```
 */
export function usePageTitleSafe(): PageTitleState {
  const context = useContext(PageTitleStateContext);

  // Return default state if outside provider (no error thrown)
  return context ?? defaultState;
}

/**
 * Hook to set the page title
 *
 * Use this hook in page components to set their title.
 * This hook only subscribes to the dispatch context, so components
 * using it won't re-render when the title changes.
 *
 * @returns Object containing the setPageTitle function
 * @throws Error if used outside PageTitleProvider
 *
 * @example
 * ```tsx
 * function LotteryPage() {
 *   const { setPageTitle } = useSetPageTitle();
 *
 *   useEffect(() => {
 *     setPageTitle("Lottery Management");
 *     return () => setPageTitle(null); // Cleanup on unmount
 *   }, [setPageTitle]);
 *
 *   return <div>Page content...</div>;
 * }
 * ```
 */
export function useSetPageTitle(): PageTitleDispatch {
  const context = useContext(PageTitleDispatchContext);

  if (context === undefined) {
    throw new Error('useSetPageTitle must be used within a PageTitleProvider');
  }

  return context;
}

/**
 * Hook to set page title declaratively with automatic cleanup
 *
 * This is a convenience hook that sets the page title on mount
 * and clears it on unmount. Use this in page components for
 * simple, declarative page title management.
 *
 * @param title - The page title to display
 *
 * @example
 * ```tsx
 * function LotteryPage() {
 *   usePageTitleEffect("Lottery Management");
 *
 *   return <div>Page content...</div>;
 * }
 * ```
 */
export function usePageTitleEffect(title: string): void {
  const { setPageTitle } = useSetPageTitle();

  useEffect(() => {
    setPageTitle(title);

    // Cleanup: reset title when component unmounts
    return () => {
      setPageTitle(null);
    };
  }, [title, setPageTitle]);
}
