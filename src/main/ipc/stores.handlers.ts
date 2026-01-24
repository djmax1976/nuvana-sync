/**
 * Stores IPC Handlers
 *
 * Provides store information endpoints for the renderer.
 * This is a single-store application, so we only return the configured store.
 *
 * @module main/ipc/stores
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 */

import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL, type Store } from '../dal/stores.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Store info response - simplified store data for the renderer
 */
interface StoreInfo {
  store_id: string;
  company_id: string;
  name: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Store status response
 */
interface StoreStatusResponse {
  isConfigured: boolean;
  store: StoreInfo | null;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('stores-handlers');

// ============================================================================
// Get Store Info Handler
// ============================================================================

/**
 * Get the configured store information
 * Returns the single configured store for this installation
 */
registerHandler<StoreInfo | ReturnType<typeof createErrorResponse>>(
  'stores:getInfo',
  async () => {
    try {
      // DB-006: Get configured store
      const store = storesDAL.getConfiguredStore();

      if (!store) {
        log.warn('Store info requested but no store configured');
        return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
      }

      const storeInfo: StoreInfo = {
        store_id: store.store_id,
        company_id: store.company_id,
        name: store.name,
        timezone: store.timezone,
        status: store.status,
      };

      log.debug('Store info retrieved', {
        storeId: store.store_id,
        name: store.name,
      });

      return storeInfo;
    } catch (error) {
      log.error('Failed to get store info', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get configured store information' }
);

// ============================================================================
// Get Store Status Handler
// ============================================================================

/**
 * Get store configuration status
 * Returns whether a store is configured and its basic info
 */
registerHandler<StoreStatusResponse>(
  'stores:getStatus',
  async () => {
    try {
      const store = storesDAL.getConfiguredStore();

      const response: StoreStatusResponse = {
        isConfigured: !!store,
        store: store
          ? {
              store_id: store.store_id,
              company_id: store.company_id,
              name: store.name,
              timezone: store.timezone,
              status: store.status,
            }
          : null,
      };

      log.debug('Store status checked', {
        isConfigured: response.isConfigured,
      });

      return response;
    } catch (error) {
      log.error('Failed to get store status', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get store configuration status' }
);

// ============================================================================
// Check Store Configured Handler
// ============================================================================

/**
 * Simple check if any store is configured
 * Returns a boolean - lighter weight than getStatus
 */
registerHandler<boolean>(
  'stores:isConfigured',
  async () => {
    try {
      const isConfigured = storesDAL.isConfigured();

      log.debug('Store configured check', { isConfigured });

      return isConfigured;
    } catch (error) {
      log.error('Failed to check store configuration', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Check if store is configured' }
);
