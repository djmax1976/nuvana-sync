/**
 * License IPC Handlers
 *
 * Handles license-related IPC requests from the renderer process.
 * Provides secure access to license state and refresh capabilities.
 *
 * @module main/ipc/license.handlers
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Centralized error handling
 * @security LM-001: Structured logging
 * @security SEC-017: Audit logging for license operations
 */

import {
  registerHandler,
  createSuccessResponse,
  type IPCResponse,
} from './index';
import {
  licenseService,
  type LicenseState,
} from '../services/license.service';
import { cloudApiService } from '../services/cloud-api.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('license-handlers');

// ============================================================================
// Handlers
// ============================================================================

/**
 * Get current license status
 * No authentication required - needed for app to determine initial state
 *
 * Channel: license:getStatus
 */
registerHandler(
  'license:getStatus',
  async (): Promise<IPCResponse<LicenseState>> => {
    const state = licenseService.getState();

    log.debug('License status requested', {
      valid: state.valid,
      daysRemaining: state.daysRemaining,
      showWarning: state.showWarning,
    });

    return createSuccessResponse(state);
  },
  {
    description: 'Get current license status',
  }
);

/**
 * Force a license check by calling the API
 * No authentication required - allows locked-out users to retry
 *
 * Channel: license:checkNow
 */
registerHandler(
  'license:checkNow',
  async (): Promise<IPCResponse<LicenseState>> => {
    log.info('Manual license check requested');

    try {
      // Force API call to refresh license
      await cloudApiService.checkLicense();

      const state = licenseService.getState();

      log.info('License check completed', {
        valid: state.valid,
        expiresAt: state.expiresAt,
        status: state.status,
      });

      return createSuccessResponse(state);
    } catch (error) {
      log.error('License check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return current cached state even on error
      const state = licenseService.getState();
      return createSuccessResponse(state);
    }
  },
  {
    description: 'Force license check via API',
  }
);

/**
 * Get days until license expiry
 * No authentication required
 *
 * Channel: license:getDaysRemaining
 */
registerHandler(
  'license:getDaysRemaining',
  async (): Promise<IPCResponse<{ daysRemaining: number | null; inGracePeriod: boolean }>> => {
    const daysRemaining = licenseService.getDaysUntilExpiry();
    const inGracePeriod = licenseService.isInGracePeriod();

    return createSuccessResponse({
      daysRemaining,
      inGracePeriod,
    });
  },
  {
    description: 'Get days until license expiry',
  }
);

/**
 * Check if warning should be shown
 * No authentication required
 *
 * Channel: license:shouldShowWarning
 */
registerHandler(
  'license:shouldShowWarning',
  async (): Promise<IPCResponse<{ showWarning: boolean; daysRemaining: number | null }>> => {
    const showWarning = licenseService.shouldShowWarning();
    const daysRemaining = licenseService.getDaysUntilExpiry();

    return createSuccessResponse({
      showWarning,
      daysRemaining,
    });
  },
  {
    description: 'Check if license warning should be shown',
  }
);

// Log handler registration
log.info('License IPC handlers registered');
