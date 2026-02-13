/**
 * Sync Monitor Page — Redirect
 *
 * The Sync Monitor is now embedded in the Settings page.
 * This redirect preserves backward compatibility for deep links to /#/sync.
 *
 * @module renderer/pages/SyncMonitorPage
 */

import { Navigate } from 'react-router-dom';

export default function SyncMonitorPage() {
  return <Navigate to="/settings" replace />;
}
