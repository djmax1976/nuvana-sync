/**
 * Internal Event Bus for main process communication
 *
 * Used for communication between IPC handlers and services
 * that can't be done via direct imports (circular deps, timing, etc.)
 */

import { EventEmitter } from 'events';

class MainProcessEventBus extends EventEmitter {
  private static instance: MainProcessEventBus;

  private constructor() {
    super();
    // Increase max listeners since we may have multiple listeners
    this.setMaxListeners(20);
  }

  static getInstance(): MainProcessEventBus {
    if (!MainProcessEventBus.instance) {
      MainProcessEventBus.instance = new MainProcessEventBus();
    }
    return MainProcessEventBus.instance;
  }
}

export const eventBus = MainProcessEventBus.getInstance();

// Event types for type safety
export const MainEvents = {
  FILE_WATCHER_RESTART: 'file-watcher:restart',
  FILE_WATCHER_PROCESS_EXISTING: 'file-watcher:process-existing',
  /** Emitted when a shift is closed via POS XML detection */
  SHIFT_CLOSED: 'shift:closed',
  /**
   * Emitted when initial setup wizard is completed.
   * Triggers service initialization (sync engine, user sync, lottery sync, file watcher).
   * This enables sync to start immediately after API key is configured during setup,
   * without requiring an app restart.
   */
  SETUP_COMPLETED: 'setup:completed',
  /**
   * Emitted when a sync metric is collected.
   * Phase 6 (D6.1): Structured metrics for observability.
   */
  SYNC_METRIC_EMITTED: 'sync:metric:emitted',
  /**
   * Emitted when a sync alert is triggered.
   * Phase 6 (D6.2): Threshold-based alerting.
   */
  SYNC_ALERT_TRIGGERED: 'sync:alert:triggered',
  /**
   * Emitted when a sync alert is resolved.
   * Phase 6 (D6.2): Alert lifecycle management.
   */
  SYNC_ALERT_RESOLVED: 'sync:alert:resolved',
} as const;
