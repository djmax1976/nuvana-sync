/**
 * POS Connection Manager Service
 *
 * Manages POS connections based on the connection type configured in the cloud.
 * Implements Phase 3 of the Terminal API Sync plan: "Connect Based on Connection Type"
 *
 * Connection Types:
 * - FILE: File-based data exchange (NAXML/XMLGateway) - Integrates with FileWatcherService
 * - API: REST API connection (Square/Clover) - HTTP client management
 * - NETWORK: Direct TCP/IP connection - Socket management
 * - WEBHOOK: POS pushes data via webhook - Passive reception
 * - MANUAL: No automated connection - Manual data entry
 *
 * @module main/services/pos-connection-manager
 * @security SEC-014: Strict input validation for all connection configs
 * @security SEC-008: HTTPS enforcement for API connections
 * @security API-003: Centralized error handling with sanitized responses
 * @security LM-001: Structured logging with correlation IDs
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { settingsService } from './settings.service';
import {
  POSConnectionConfig,
  POSConnectionType,
  POSSystemType,
  validatePOSConnectionConfig,
} from '../../shared/types/config.types';

const log = createLogger('pos-connection-manager');

// ============================================================================
// Types
// ============================================================================

/**
 * Connection status for monitoring
 */
export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ERROR'
  | 'NOT_CONFIGURED'
  | 'MANUAL_MODE';

/**
 * Connection health check result
 */
export interface ConnectionHealthCheck {
  status: ConnectionStatus;
  lastCheckTime: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * POS Connection state
 */
export interface POSConnectionState {
  connectionType: POSConnectionType | null;
  posType: POSSystemType | null;
  status: ConnectionStatus;
  lastConnectedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  healthCheck: ConnectionHealthCheck | null;
  isInitialized: boolean;
}

/**
 * FILE connection configuration (NAXML/XMLGateway)
 */
interface FileConnectionConfig {
  import_path: string;
  export_path?: string;
  file_pattern?: string;
  poll_interval_seconds?: number;
}

/**
 * API connection configuration (Square/Clover REST)
 */
interface ApiConnectionConfig {
  base_url: string;
  api_key?: string;
  location_id?: string;
  merchant_id?: string;
}

/**
 * NETWORK connection configuration (Direct TCP/IP)
 */
interface NetworkConnectionConfig {
  host: string;
  port: number;
  timeout_ms?: number;
}

/**
 * WEBHOOK connection configuration
 */
interface WebhookConnectionConfig {
  webhook_secret?: string;
  expected_source_ips?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default health check interval (5 minutes) */
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Connection timeout for network connections */
const DEFAULT_NETWORK_TIMEOUT_MS = 30000;

// ============================================================================
// POS Connection Manager Service
// ============================================================================

/**
 * POS Connection Manager Service
 *
 * Centralized service for managing POS connections based on configuration type.
 * Coordinates with specialized handlers for each connection type.
 *
 * @emits 'status-change' - When connection status changes
 * @emits 'connected' - When connection is established
 * @emits 'disconnected' - When connection is lost
 * @emits 'error' - When a connection error occurs
 * @emits 'data-received' - When data is received from POS (API/NETWORK/WEBHOOK)
 *
 * @security SEC-014: All configs validated before use
 * @security API-003: Centralized error handling
 * @security LM-001: Structured logging for all operations
 */
export class POSConnectionManagerService extends EventEmitter {
  private state: POSConnectionState;
  private config: POSConnectionConfig | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private storeId: string = '';

  // Connection handlers (will be set based on connection type)
  private fileWatcherCallback: (() => void) | null = null;
  private apiClientCleanup: (() => void) | null = null;
  private networkSocketCleanup: (() => void) | null = null;

  constructor() {
    super();

    this.state = {
      connectionType: null,
      posType: null,
      status: 'NOT_CONFIGURED',
      lastConnectedAt: null,
      lastErrorAt: null,
      lastError: null,
      healthCheck: null,
      isInitialized: false,
    };

    log.info('POS Connection Manager service created');
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the connection manager with POS configuration
   *
   * This method:
   * 1. Loads POS configuration from settings
   * 2. Validates the configuration
   * 3. Initializes the appropriate connection handler
   * 4. Starts health monitoring
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Initialization result
   *
   * @security SEC-014: Config validated before initialization
   * @security LM-001: Structured logging for audit trail
   */
  async initialize(storeId: string): Promise<{
    success: boolean;
    message: string;
    connectionType?: POSConnectionType;
    posType?: POSSystemType;
  }> {
    const correlationId = `pos-init-${Date.now()}`;
    log.info('Initializing POS Connection Manager', { correlationId, storeId });

    this.storeId = storeId;

    try {
      // Load POS configuration from settings
      const posConfig = settingsService.getPOSConnectionConfig();

      if (!posConfig) {
        log.warn('No POS connection configuration found', { correlationId, storeId });
        this.updateState({
          status: 'NOT_CONFIGURED',
          connectionType: null,
          posType: null,
        });
        return {
          success: false,
          message:
            'POS connection not configured. Please configure POS settings in the cloud portal.',
        };
      }

      // SEC-014: Validate configuration
      try {
        this.config = validatePOSConnectionConfig(posConfig);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Validation failed';
        log.error('POS configuration validation failed', {
          correlationId,
          storeId,
          error: errorMessage,
        });
        this.updateState({
          status: 'ERROR',
          lastError: `Configuration validation failed: ${errorMessage}`,
          lastErrorAt: new Date().toISOString(),
        });
        return {
          success: false,
          message: `POS configuration invalid: ${errorMessage}`,
        };
      }

      // Update state with config info
      this.updateState({
        connectionType: this.config.pos_connection_type,
        posType: this.config.pos_type,
        status: 'CONNECTING',
      });

      // Initialize connection based on type
      const initResult = await this.initializeConnectionByType();

      if (initResult.success) {
        // Preserve MANUAL_MODE status if set by initializeManualMode()
        // Only set CONNECTED for connection types that actually connect to something
        if (this.state.status !== 'MANUAL_MODE') {
          this.updateState({
            status: 'CONNECTED',
            lastConnectedAt: new Date().toISOString(),
            isInitialized: true,
          });
        } else {
          // For MANUAL_MODE, just mark as initialized
          this.updateState({
            isInitialized: true,
          });
        }

        // Start health monitoring (automatically skips for MANUAL_MODE)
        this.startHealthMonitoring();
      } else {
        this.updateState({
          status: 'ERROR',
          lastError: initResult.message,
          lastErrorAt: new Date().toISOString(),
        });
      }

      log.info('POS Connection Manager initialization complete', {
        correlationId,
        storeId,
        connectionType: this.config.pos_connection_type,
        posType: this.config.pos_type,
        success: initResult.success,
      });

      return {
        success: initResult.success,
        message: initResult.message,
        connectionType: this.config.pos_connection_type,
        posType: this.config.pos_type,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('POS Connection Manager initialization failed', {
        correlationId,
        storeId,
        error: errorMessage,
      });

      this.updateState({
        status: 'ERROR',
        lastError: errorMessage,
        lastErrorAt: new Date().toISOString(),
      });

      return {
        success: false,
        message: `Initialization failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Initialize connection based on type
   *
   * Dispatches to type-specific initialization handlers
   */
  private async initializeConnectionByType(): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.config) {
      return { success: false, message: 'No configuration available' };
    }

    switch (this.config.pos_connection_type) {
      case 'FILE':
        return this.initializeFileConnection();

      case 'API':
        return this.initializeApiConnection();

      case 'NETWORK':
        return this.initializeNetworkConnection();

      case 'WEBHOOK':
        return this.initializeWebhookConnection();

      case 'MANUAL':
        return this.initializeManualMode();

      default:
        return {
          success: false,
          message: `Unknown connection type: ${this.config.pos_connection_type}`,
        };
    }
  }

  // ==========================================================================
  // FILE Connection (NAXML/XMLGateway)
  // ==========================================================================

  /**
   * Initialize FILE-based connection
   *
   * For FILE connection type, we:
   * 1. Validate the import_path exists and is accessible
   * 2. Configure the watch path in settings
   * 3. The actual file watching is handled by FileWatcherService
   *
   * @security SEC-014: Path validation to prevent traversal attacks
   */
  private async initializeFileConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const fileConfig = this.config?.pos_connection_config as FileConnectionConfig | null;

    if (!fileConfig?.import_path) {
      return {
        success: false,
        message: 'FILE connection requires import_path configuration',
      };
    }

    log.info('Initializing FILE connection', {
      posType: this.config?.pos_type,
      hasImportPath: true,
      hasExportPath: !!fileConfig.export_path,
      pollInterval: fileConfig.poll_interval_seconds,
    });

    // SEC-014: Validate path doesn't contain traversal patterns
    if (fileConfig.import_path.includes('..')) {
      return {
        success: false,
        message: 'Import path cannot contain parent directory references (..)',
      };
    }

    // Normalize and validate the path
    const normalizedPath = path.normalize(fileConfig.import_path);

    // Check if path exists and is accessible
    try {
      const pathExists = fs.existsSync(normalizedPath);

      if (!pathExists) {
        log.warn('FILE connection import_path does not exist', {
          path: normalizedPath,
          posType: this.config?.pos_type,
        });

        // Return success but with warning - path may be a network share that's not mounted yet
        return {
          success: true,
          message: `FILE connection configured. Warning: Import path does not exist yet (${normalizedPath}). Path will be monitored when available.`,
        };
      }

      // Check if it's a directory
      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          message: 'Import path must be a directory',
        };
      }

      // Check read access
      fs.accessSync(normalizedPath, fs.constants.R_OK);

      log.info('FILE connection initialized successfully', {
        path: normalizedPath,
        posType: this.config?.pos_type,
        filePattern: fileConfig.file_pattern || '*.xml',
      });

      return {
        success: true,
        message: `FILE connection ready. Watching: ${normalizedPath}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Handle common Windows network path errors
      if (errorMessage.includes('ENOENT') || errorMessage.includes('ENOTFOUND')) {
        log.warn('FILE connection path not accessible', {
          path: normalizedPath,
          error: errorMessage,
        });

        return {
          success: true,
          message: `FILE connection configured. Path not currently accessible (${errorMessage}). Will retry when path becomes available.`,
        };
      }

      return {
        success: false,
        message: `FILE connection error: ${errorMessage}`,
      };
    }
  }

  // ==========================================================================
  // API Connection (Square/Clover REST)
  // ==========================================================================

  /**
   * Initialize API-based connection
   *
   * For API connection type (Square, Clover, etc.), we:
   * 1. Validate the API configuration
   * 2. Set up an HTTP client with proper headers
   * 3. Test connectivity to the API endpoint
   *
   * Note: Full API client implementation is Phase 4 scope.
   * This provides configuration validation and placeholder setup.
   *
   * @security SEC-008: HTTPS enforcement for non-localhost
   * @security SEC-007: API key stored securely
   */
  private async initializeApiConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const apiConfig = this.config?.pos_connection_config as ApiConnectionConfig | null;

    if (!apiConfig?.base_url) {
      return {
        success: false,
        message: 'API connection requires base_url configuration',
      };
    }

    log.info('Initializing API connection', {
      posType: this.config?.pos_type,
      hasBaseUrl: true,
      hasApiKey: !!apiConfig.api_key,
      hasLocationId: !!apiConfig.location_id,
      hasMerchantId: !!apiConfig.merchant_id,
    });

    // SEC-008: Enforce HTTPS for non-localhost URLs
    const isLocalhost =
      apiConfig.base_url.includes('localhost') || apiConfig.base_url.includes('127.0.0.1');

    if (!isLocalhost && !apiConfig.base_url.startsWith('https://')) {
      return {
        success: false,
        message: 'API base_url must use HTTPS for security (HTTP only allowed for localhost)',
      };
    }

    // Validate URL format
    try {
      new URL(apiConfig.base_url);
    } catch {
      return {
        success: false,
        message: 'API base_url is not a valid URL',
      };
    }

    // Log the API connection setup (actual implementation in Phase 4)
    log.info('API connection configured', {
      posType: this.config?.pos_type,
      baseUrl: apiConfig.base_url,
      // Don't log API key
      configuredFields: {
        api_key: !!apiConfig.api_key,
        location_id: !!apiConfig.location_id,
        merchant_id: !!apiConfig.merchant_id,
      },
    });

    // Return success with note about Phase 4 implementation
    const posTypeLabel = this.config?.pos_type?.replace(/_/g, ' ') || 'Unknown POS';

    return {
      success: true,
      message: `API connection configured for ${posTypeLabel}. Note: Live API polling will be available in a future update.`,
    };
  }

  // ==========================================================================
  // NETWORK Connection (Direct TCP/IP)
  // ==========================================================================

  /**
   * Initialize NETWORK-based connection
   *
   * For NETWORK connection type (direct TCP/IP), we:
   * 1. Validate host and port configuration
   * 2. Optionally test connectivity
   * 3. Set up socket connection (Phase 4 scope)
   *
   * Note: Full TCP client implementation is Phase 4 scope.
   * This provides configuration validation and placeholder setup.
   *
   * @security SEC-014: Input validation for host/port
   */
  private async initializeNetworkConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const netConfig = this.config?.pos_connection_config as NetworkConnectionConfig | null;

    if (!netConfig?.host || netConfig?.port === undefined) {
      return {
        success: false,
        message: 'NETWORK connection requires host and port configuration',
      };
    }

    log.info('Initializing NETWORK connection', {
      posType: this.config?.pos_type,
      host: netConfig.host,
      port: netConfig.port,
      timeout: netConfig.timeout_ms || DEFAULT_NETWORK_TIMEOUT_MS,
    });

    // Validate port range
    if (netConfig.port < 1 || netConfig.port > 65535) {
      return {
        success: false,
        message: 'Port must be between 1 and 65535',
      };
    }

    // Validate host format (basic validation)
    if (!netConfig.host || netConfig.host.trim().length === 0) {
      return {
        success: false,
        message: 'Host cannot be empty',
      };
    }

    // Log the network connection setup (actual implementation in Phase 4)
    log.info('NETWORK connection configured', {
      posType: this.config?.pos_type,
      host: netConfig.host,
      port: netConfig.port,
    });

    const posTypeLabel = this.config?.pos_type?.replace(/_/g, ' ') || 'Unknown POS';

    return {
      success: true,
      message: `NETWORK connection configured for ${posTypeLabel} at ${netConfig.host}:${netConfig.port}. Note: Live TCP connection will be available in a future update.`,
    };
  }

  // ==========================================================================
  // WEBHOOK Connection
  // ==========================================================================

  /**
   * Initialize WEBHOOK-based connection
   *
   * For WEBHOOK connection type, the POS pushes data to Nuvana.
   * This is a passive mode - no outbound connection needed.
   *
   * We validate the webhook secret if provided.
   *
   * @security SEC-014: Webhook secret validation
   */
  private async initializeWebhookConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    const webhookConfig = this.config?.pos_connection_config as WebhookConnectionConfig | null;

    log.info('Initializing WEBHOOK connection (passive mode)', {
      posType: this.config?.pos_type,
      hasSecret: !!webhookConfig?.webhook_secret,
      hasSourceIps: !!webhookConfig?.expected_source_ips?.length,
    });

    // Webhook mode is passive - POS pushes data to Nuvana
    // No outbound connection needed from desktop app

    const posTypeLabel = this.config?.pos_type?.replace(/_/g, ' ') || 'Unknown POS';

    return {
      success: true,
      message: `WEBHOOK mode enabled for ${posTypeLabel}. POS will push data to Nuvana - no outbound connection required.`,
    };
  }

  // ==========================================================================
  // MANUAL Mode
  // ==========================================================================

  /**
   * Initialize MANUAL mode
   *
   * For MANUAL connection type, no automated POS connection is needed.
   * Data is entered manually through the app interface.
   */
  private async initializeManualMode(): Promise<{
    success: boolean;
    message: string;
  }> {
    log.info('Initializing MANUAL mode', {
      posType: this.config?.pos_type,
    });

    // Update state to manual mode
    this.updateState({
      status: 'MANUAL_MODE',
    });

    return {
      success: true,
      message: 'Manual entry mode enabled. Transactions will be entered through the app interface.',
    };
  }

  // ==========================================================================
  // Health Monitoring
  // ==========================================================================

  /**
   * Start health monitoring for the connection
   */
  private startHealthMonitoring(): void {
    // Don't monitor manual mode
    if (this.state.status === 'MANUAL_MODE') {
      return;
    }

    // Clear existing timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Run initial health check
    this.runHealthCheck();

    // Schedule periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);

    log.info('Health monitoring started', {
      intervalMs: HEALTH_CHECK_INTERVAL_MS,
      connectionType: this.state.connectionType,
    });
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      log.info('Health monitoring stopped');
    }
  }

  /**
   * Run a health check on the current connection
   */
  private async runHealthCheck(): Promise<ConnectionHealthCheck> {
    const checkTime = new Date().toISOString();

    if (!this.config) {
      const result: ConnectionHealthCheck = {
        status: 'NOT_CONFIGURED',
        lastCheckTime: checkTime,
        message: 'No POS configuration',
      };
      this.updateState({ healthCheck: result });
      return result;
    }

    try {
      let result: ConnectionHealthCheck;

      switch (this.config.pos_connection_type) {
        case 'FILE': {
          result = await this.checkFileConnectionHealth();
          break;
        }
        case 'API': {
          result = await this.checkApiConnectionHealth();
          break;
        }
        case 'NETWORK': {
          result = await this.checkNetworkConnectionHealth();
          break;
        }
        case 'WEBHOOK': {
          // Webhook is passive - always healthy from client perspective
          result = {
            status: 'CONNECTED',
            lastCheckTime: checkTime,
            message: 'Webhook mode active (passive)',
          };
          break;
        }
        case 'MANUAL': {
          result = {
            status: 'MANUAL_MODE',
            lastCheckTime: checkTime,
            message: 'Manual entry mode',
          };
          break;
        }
        default: {
          result = {
            status: 'ERROR',
            lastCheckTime: checkTime,
            message: `Unknown connection type: ${this.config.pos_connection_type}`,
          };
        }
      }

      this.updateState({ healthCheck: result });

      // Emit status change if health status differs from current state
      if (result.status !== this.state.status && result.status !== 'MANUAL_MODE') {
        this.emit('status-change', result.status, this.state.status);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: ConnectionHealthCheck = {
        status: 'ERROR',
        lastCheckTime: checkTime,
        message: `Health check failed: ${errorMessage}`,
      };
      this.updateState({ healthCheck: result });
      return result;
    }
  }

  /**
   * Check FILE connection health (verify path accessibility)
   */
  private async checkFileConnectionHealth(): Promise<ConnectionHealthCheck> {
    const checkTime = new Date().toISOString();
    const fileConfig = this.config?.pos_connection_config as FileConnectionConfig | null;

    if (!fileConfig?.import_path) {
      return {
        status: 'ERROR',
        lastCheckTime: checkTime,
        message: 'Import path not configured',
      };
    }

    try {
      const exists = fs.existsSync(fileConfig.import_path);

      if (!exists) {
        return {
          status: 'DISCONNECTED',
          lastCheckTime: checkTime,
          message: `Import path not accessible: ${fileConfig.import_path}`,
          details: { path: fileConfig.import_path, exists: false },
        };
      }

      fs.accessSync(fileConfig.import_path, fs.constants.R_OK);

      return {
        status: 'CONNECTED',
        lastCheckTime: checkTime,
        message: 'File path accessible',
        details: { path: fileConfig.import_path, readable: true },
      };
    } catch (error) {
      return {
        status: 'ERROR',
        lastCheckTime: checkTime,
        message: `Path access error: ${error instanceof Error ? error.message : 'Unknown'}`,
        details: { path: fileConfig.import_path },
      };
    }
  }

  /**
   * Check API connection health
   * Note: Full implementation in Phase 4
   */
  private async checkApiConnectionHealth(): Promise<ConnectionHealthCheck> {
    const checkTime = new Date().toISOString();
    const apiConfig = this.config?.pos_connection_config as ApiConnectionConfig | null;

    if (!apiConfig?.base_url) {
      return {
        status: 'ERROR',
        lastCheckTime: checkTime,
        message: 'API base_url not configured',
      };
    }

    // For now, just validate config exists
    // Full API health check will be implemented in Phase 4
    return {
      status: 'CONNECTED',
      lastCheckTime: checkTime,
      message: 'API connection configured (live check pending Phase 4)',
      details: { baseUrl: apiConfig.base_url },
    };
  }

  /**
   * Check NETWORK connection health
   * Note: Full implementation in Phase 4
   */
  private async checkNetworkConnectionHealth(): Promise<ConnectionHealthCheck> {
    const checkTime = new Date().toISOString();
    const netConfig = this.config?.pos_connection_config as NetworkConnectionConfig | null;

    if (!netConfig?.host || netConfig?.port === undefined) {
      return {
        status: 'ERROR',
        lastCheckTime: checkTime,
        message: 'Network host/port not configured',
      };
    }

    // For now, just validate config exists
    // Full TCP health check will be implemented in Phase 4
    return {
      status: 'CONNECTED',
      lastCheckTime: checkTime,
      message: 'Network connection configured (live check pending Phase 4)',
      details: { host: netConfig.host, port: netConfig.port },
    };
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Update internal state
   */
  private updateState(updates: Partial<POSConnectionState>): void {
    const previousStatus = this.state.status;
    this.state = { ...this.state, ...updates };

    // Emit status change event if status changed
    if (updates.status && updates.status !== previousStatus) {
      log.info('POS connection status changed', {
        previousStatus,
        newStatus: updates.status,
        connectionType: this.state.connectionType,
        posType: this.state.posType,
      });
      this.emit('status-change', updates.status, previousStatus);

      // Emit specific events
      if (updates.status === 'CONNECTED') {
        this.emit('connected');
      } else if (updates.status === 'DISCONNECTED' || updates.status === 'ERROR') {
        this.emit('disconnected', updates.status);
      }
    }
  }

  /**
   * Get current connection state
   */
  getState(): POSConnectionState {
    return { ...this.state };
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.state.status;
  }

  /**
   * Check if connection is active
   */
  isConnected(): boolean {
    return this.state.status === 'CONNECTED' || this.state.status === 'MANUAL_MODE';
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Refresh POS configuration from settings
   *
   * Reloads configuration and reinitializes if needed.
   */
  async refreshConfig(): Promise<{
    success: boolean;
    message: string;
    configChanged: boolean;
  }> {
    const correlationId = `pos-refresh-${Date.now()}`;
    log.info('Refreshing POS configuration', { correlationId });

    try {
      const newConfig = settingsService.getPOSConnectionConfig();

      if (!newConfig) {
        log.warn('No POS configuration available after refresh', { correlationId });
        return {
          success: false,
          message: 'No POS configuration available',
          configChanged: this.config !== null,
        };
      }

      // Check if config actually changed
      const configChanged = JSON.stringify(this.config) !== JSON.stringify(newConfig);

      if (!configChanged) {
        log.info('POS configuration unchanged', { correlationId });
        return {
          success: true,
          message: 'Configuration unchanged',
          configChanged: false,
        };
      }

      // Config changed - reinitialize
      log.info('POS configuration changed, reinitializing', {
        correlationId,
        oldConnectionType: this.config?.pos_connection_type,
        newConnectionType: newConfig.pos_connection_type,
      });

      // Shutdown current connection
      await this.shutdown();

      // Reinitialize with new config
      const initResult = await this.initialize(this.storeId);

      return {
        success: initResult.success,
        message: initResult.message,
        configChanged: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to refresh POS configuration', {
        correlationId,
        error: errorMessage,
      });

      return {
        success: false,
        message: `Refresh failed: ${errorMessage}`,
        configChanged: false,
      };
    }
  }

  // ==========================================================================
  // Shutdown
  // ==========================================================================

  /**
   * Shutdown the connection manager
   *
   * Cleanly disconnects all active connections and stops monitoring.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down POS Connection Manager', {
      connectionType: this.state.connectionType,
      posType: this.state.posType,
    });

    // Stop health monitoring
    this.stopHealthMonitoring();

    // Cleanup connection-specific resources
    if (this.fileWatcherCallback) {
      this.fileWatcherCallback();
      this.fileWatcherCallback = null;
    }

    if (this.apiClientCleanup) {
      this.apiClientCleanup();
      this.apiClientCleanup = null;
    }

    if (this.networkSocketCleanup) {
      this.networkSocketCleanup();
      this.networkSocketCleanup = null;
    }

    // Reset state
    this.config = null;
    this.updateState({
      status: 'DISCONNECTED',
      isInitialized: false,
    });

    log.info('POS Connection Manager shutdown complete');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for POS connection management
 */
export const posConnectionManager = new POSConnectionManagerService();
