/**
 * Auth Error Handler
 *
 * Stub for handling authentication errors in the Electron app.
 * In the full bmad web app, this handles session expiration and redirects.
 * For the Electron desktop app, we'll handle this differently.
 */

/**
 * Handle 401 Unauthorized errors
 * In Electron, we don't redirect - we'll show a re-login dialog instead
 */
export function handleUnauthorizedError(): void {
  console.warn('[AuthErrorHandler] Session expired or unauthorized');
  // In Electron desktop app, we would show a re-login dialog
  // For now, just log the error
}

/**
 * Dispatch session expired event
 * Used to notify React Query to clear cache
 */
export function dispatchSessionExpiredEvent(source: string): void {
  console.warn('[AuthErrorHandler] Session expired from:', source);
  // Dispatch a custom event that components can listen for
  window.dispatchEvent(new CustomEvent('session-expired', { detail: { source } }));
}
