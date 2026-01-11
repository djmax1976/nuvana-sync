/**
 * Key Manager Service
 *
 * Secure key generation and storage using Electron safeStorage.
 * Implements SEC-007: Secrets Management with centralized key storage.
 * Implements CDP-001: Encryption with secure key generation.
 *
 * @module main/services/key-manager
 * @security SEC-007: Secrets stored in OS-protected keychain
 * @security CDP-001: 256-bit key generation using crypto.randomBytes
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';

// ============================================================================
// Constants
// ============================================================================

/**
 * Configuration store for encrypted keys
 * Uses electron-store with encryption capability
 */
const CONFIG_STORE_NAME = 'nuvana-config';
const DB_KEY_STORE_KEY = 'encryptedDbKey';
const KEY_LENGTH_BYTES = 32; // 256-bit key for SQLCipher

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('key-manager');

// ============================================================================
// Store Instance (Lazy Initialization)
// ============================================================================

let configStore: Store | null = null;

/**
 * Get or create the configuration store
 * Lazy initialization to handle app lifecycle
 */
function getConfigStore(): Store {
  if (!configStore) {
    configStore = new Store({ name: CONFIG_STORE_NAME });
    log.debug('Configuration store initialized');
  }
  return configStore;
}

// ============================================================================
// Key Manager Functions
// ============================================================================

/**
 * Check if Electron safeStorage encryption is available
 * SEC-007: Verify OS keychain availability before key operations
 *
 * @returns true if safeStorage encryption is available
 */
export function isKeyAvailable(): boolean {
  const available = safeStorage.isEncryptionAvailable();
  log.debug('SafeStorage encryption availability checked', { available });
  return available;
}

/**
 * Generate a cryptographically secure database encryption key
 * CDP-001: Use crypto.randomBytes for secure key generation
 *
 * @returns 64-character hex string (256-bit key)
 */
function generateSecureKey(): string {
  const keyBuffer = crypto.randomBytes(KEY_LENGTH_BYTES);
  const key = keyBuffer.toString('hex');
  log.debug('New database key generated', { keyLength: key.length });
  return key;
}

/**
 * Get or create the database encryption key
 * SEC-007: Encrypts key using OS-level safeStorage before persistence
 *
 * Key lifecycle:
 * 1. Check if encrypted key exists in store
 * 2. If exists, decrypt using safeStorage and return
 * 3. If not exists, generate new key, encrypt with safeStorage, store, and return
 *
 * @returns Database encryption key (64-character hex string)
 * @throws Error if safeStorage encryption is not available
 */
export function getOrCreateDatabaseKey(): string {
  // SEC-007: Verify encryption is available before proceeding
  if (!isKeyAvailable()) {
    log.error('SafeStorage encryption not available on this system');
    throw new Error(
      'SafeStorage encryption is not available. ' +
        'Database encryption requires OS-level key protection.'
    );
  }

  const store = getConfigStore();

  // Attempt to retrieve existing encrypted key
  const storedData = store.get(DB_KEY_STORE_KEY) as number[] | undefined;

  if (storedData && Array.isArray(storedData)) {
    try {
      // Reconstruct Buffer from stored array and decrypt
      const encryptedBuffer = Buffer.from(storedData);
      const decryptedKey = safeStorage.decryptString(encryptedBuffer);

      // Validate key format (should be 64-character hex)
      if (decryptedKey.length === KEY_LENGTH_BYTES * 2 && /^[a-f0-9]+$/i.test(decryptedKey)) {
        log.info('Existing database key retrieved successfully');
        return decryptedKey;
      } else {
        log.warn('Stored key has invalid format, generating new key');
      }
    } catch (error) {
      // If decryption fails (e.g., key migration, OS change), generate new key
      log.warn('Failed to decrypt stored key, generating new key', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Generate new key
  const newKey = generateSecureKey();

  // Encrypt using OS-level safeStorage
  const encryptedBuffer = safeStorage.encryptString(newKey);

  // Store encrypted key as JSON-compatible array
  // SEC-007: Never store plaintext key
  store.set(DB_KEY_STORE_KEY, Array.from(encryptedBuffer));

  log.info('New database key generated and securely stored');
  return newKey;
}

/**
 * Clear the stored database key
 * USE WITH CAUTION: This will make existing database inaccessible
 *
 * @returns true if key was cleared, false if no key existed
 */
export function clearDatabaseKey(): boolean {
  const store = getConfigStore();
  const existed = store.has(DB_KEY_STORE_KEY);

  if (existed) {
    store.delete(DB_KEY_STORE_KEY);
    log.warn('Database key cleared from store');
  }

  return existed;
}

/**
 * Check if a database key exists in the store
 *
 * @returns true if an encrypted key is stored
 */
export function hasDatabaseKey(): boolean {
  const store = getConfigStore();
  return store.has(DB_KEY_STORE_KEY);
}

/**
 * Rotate the database key (for future key rotation support)
 * CDP-002: Key rotation capability
 *
 * Note: Actual key rotation requires re-encrypting the database,
 * which must be coordinated with the database service.
 *
 * @returns Object containing old and new keys for migration
 * @throws Error if no existing key or safeStorage unavailable
 */
export function rotateKey(): { oldKey: string; newKey: string } {
  if (!isKeyAvailable()) {
    throw new Error('SafeStorage encryption not available');
  }

  // Get existing key
  const oldKey = getOrCreateDatabaseKey();

  // Generate new key
  const newKey = generateSecureKey();

  // Note: Caller is responsible for re-encrypting database
  // before calling commitKeyRotation()

  log.info('Key rotation initiated - awaiting database re-encryption');
  return { oldKey, newKey };
}

/**
 * Commit a key rotation by storing the new key
 * Should only be called after successful database re-encryption
 *
 * @param newKey - The new key to store
 */
export function commitKeyRotation(newKey: string): void {
  if (!isKeyAvailable()) {
    throw new Error('SafeStorage encryption not available');
  }

  // Validate key format
  if (newKey.length !== KEY_LENGTH_BYTES * 2 || !/^[a-f0-9]+$/i.test(newKey)) {
    throw new Error('Invalid key format: expected 64-character hex string');
  }

  const store = getConfigStore();

  // Encrypt and store new key
  const encryptedBuffer = safeStorage.encryptString(newKey);
  store.set(DB_KEY_STORE_KEY, Array.from(encryptedBuffer));

  log.info('Key rotation committed successfully');
}
