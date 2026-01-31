/**
 * Global Test Setup
 *
 * Provides test isolation utilities following enterprise standards.
 *
 * Compliance:
 * - TEST-003: TEST_ISOLATION - Each test must be independent; no shared mutable state
 * - TEST-001: TEST_AAA_PATTERN - Arrange-Act-Assert pattern support
 *
 * @module tests/setup
 */

// ============================================================================
// Global State Type Declarations
// ============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __syncHandlers: Map<string, unknown> | undefined;
  // eslint-disable-next-line no-var
  var __dlqHandlers: Map<string, unknown> | undefined;
  // eslint-disable-next-line no-var
  var __mockStoreData: Map<string, unknown> | undefined;
}

// ============================================================================
// Cleanup Utilities
// ============================================================================

/**
 * Clears mock data stores only (not handler registries).
 * Use this for cleanup within a test file where handlers should persist.
 *
 * Handler registries (__syncHandlers, __dlqHandlers) are registered once
 * at module import time and should persist throughout the test file.
 *
 * Compliance: TEST-003 - Reset test-specific state in afterEach hooks
 */
export function clearMockStoreData(): void {
  // Clear mock store data - this is test-specific data that can pollute between tests
  if (globalThis.__mockStoreData) {
    globalThis.__mockStoreData.clear();
  }
}

/**
 * Clears ALL global test state including handler registries.
 * Use this only when test files are completely finished and isolation
 * between different test files is required.
 *
 * WARNING: Do NOT use this in afterEach within a test file that uses
 * IPC handler registries - use clearMockStoreData() instead.
 *
 * Compliance: TEST-003 - Reset all shared state for complete isolation
 */
export function clearGlobalTestState(): void {
  // Clear IPC handler registries (only for cross-file isolation)
  if (globalThis.__syncHandlers) {
    globalThis.__syncHandlers.clear();
    delete (globalThis as Record<string, unknown>).__syncHandlers;
  }

  if (globalThis.__dlqHandlers) {
    globalThis.__dlqHandlers.clear();
    delete (globalThis as Record<string, unknown>).__dlqHandlers;
  }

  // Clear mock store data
  if (globalThis.__mockStoreData) {
    globalThis.__mockStoreData.clear();
    delete (globalThis as Record<string, unknown>).__mockStoreData;
  }
}

/**
 * Initializes fresh global state maps.
 * Call this in beforeEach hooks when tests need these globals.
 *
 * Compliance: TEST-003 - Use fresh instances of mocks and fixtures per test
 */
export function initializeGlobalTestState(): void {
  // Initialize only if not already present
  // This preserves existing initialization from vi.mock blocks
  if (typeof globalThis.__syncHandlers === 'undefined') {
    globalThis.__syncHandlers = new Map();
  }

  if (typeof globalThis.__dlqHandlers === 'undefined') {
    globalThis.__dlqHandlers = new Map();
  }

  if (typeof globalThis.__mockStoreData === 'undefined') {
    globalThis.__mockStoreData = new Map();
  }
}
