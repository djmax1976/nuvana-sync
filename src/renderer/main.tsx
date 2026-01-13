/**
 * Renderer Entry Point
 *
 * Main entry point for the Electron renderer process.
 * Sets up React with TanStack Query and React Router.
 *
 * @module renderer/main
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from './router';
import './styles/globals.css';

// ============================================================================
// Query Client Configuration
// ============================================================================

/**
 * TanStack Query client with sensible defaults for desktop app
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Disable automatic refetching for desktop app (manual refresh preferred)
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      // Keep data in cache for 5 minutes
      staleTime: 5 * 60 * 1000,
      // Retry failed queries twice
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Don't retry mutations by default
      retry: false,
    },
  },
});

// ============================================================================
// Root Render
// ============================================================================

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  </React.StrictMode>
);
