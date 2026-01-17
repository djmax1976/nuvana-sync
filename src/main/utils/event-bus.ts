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
} as const;
