/**
 * Database Service
 *
 * SQLCipher-encrypted SQLite database management for Nuvana.
 * Implements DB-007: Database encryption with externally managed keys.
 * Implements SEC-006: Parameterized queries (enforced by better-sqlite3 API).
 *
 * @module main/services/database
 * @security DB-007: SQLCipher encryption at rest
 * @security SEC-006: Prepared statements for all queries
 */

import Database from 'better-sqlite3-multiple-ciphers';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getOrCreateDatabaseKey, isKeyAvailable } from './key-manager.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Database instance type exported for DAL usage
 */
export type DatabaseInstance = Database.Database;

/**
 * Database configuration options
 */
export interface DatabaseOptions {
  /** Path to database file (defaults to userData/nuvana.db) */
  dbPath?: string;
  /** Enable verbose SQL logging (debug only) */
  verbose?: boolean;
  /** Memory limit for SQLite in KB (default: 64MB) */
  memoryLimit?: number;
}

/**
 * Database health check result
 */
export interface DatabaseHealth {
  isOpen: boolean;
  isEncrypted: boolean;
  tableCount: number;
  sizeBytes: number;
  path: string;
}

// ============================================================================
// Constants
// ============================================================================

const DB_FILENAME = 'nuvana.db';
const DEFAULT_MEMORY_LIMIT_KB = 64 * 1024; // 64MB

/**
 * Check if running in development mode
 * In development, database encryption is disabled for easier debugging
 */
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * SQLCipher configuration
 * DB-007: Strong encryption settings (production only)
 */
const SQLCIPHER_CONFIG = {
  cipher: 'sqlcipher',
  kdfIter: 256000, // PBKDF2 iterations for key derivation
  pageSize: 4096, // Optimal page size for encrypted database
} as const;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('database');

// ============================================================================
// Singleton State
// ============================================================================

let dbInstance: Database.Database | null = null;
let dbPath: string | null = null;

// ============================================================================
// Database Path Management
// ============================================================================

/**
 * Get the database file path
 * DB-007: Database stored in secure user data directory
 *
 * @returns Absolute path to database file
 */
export function getDbPath(): string {
  if (dbPath) {
    return dbPath;
  }

  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, DB_FILENAME);

  log.debug('Database path resolved', { path: dbPath });
  return dbPath;
}

/**
 * Set a custom database path (for testing)
 *
 * @param customPath - Custom path to use for database
 */
export function setDbPath(customPath: string): void {
  if (dbInstance) {
    throw new Error('Cannot change database path while database is open');
  }

  // Validate path is absolute
  if (!path.isAbsolute(customPath)) {
    throw new Error('Database path must be absolute');
  }

  dbPath = customPath;
  log.info('Custom database path set', { path: dbPath });
}

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize the encrypted SQLite database
 * DB-007: Applies SQLCipher encryption with secure configuration
 *
 * Initialization steps:
 * 1. Verify safeStorage encryption availability
 * 2. Obtain encryption key from key manager
 * 3. Open database with better-sqlite3-multiple-ciphers
 * 4. Apply SQLCipher pragmas for encryption
 * 5. Verify encryption is working
 * 6. Apply performance optimizations
 *
 * @param options - Optional database configuration
 * @returns Initialized database instance
 * @throws Error if encryption not available or initialization fails
 */
export function initializeDatabase(options: DatabaseOptions = {}): Database.Database {
  // Return existing instance if already initialized
  if (dbInstance) {
    log.debug('Returning existing database instance');
    return dbInstance;
  }

  // Development mode: skip encryption for easier debugging
  if (isDevelopment) {
    log.info('Initializing database WITHOUT encryption (development mode)');
    return initializeDevelopmentDatabase(options);
  }

  log.info('Initializing encrypted database (production mode)');

  // Step 1: Verify encryption availability
  // SEC-007: Require OS-level key protection
  if (!isKeyAvailable()) {
    log.error('SafeStorage encryption not available');
    throw new Error(
      'Database initialization failed: SafeStorage encryption is required but not available'
    );
  }

  // Step 2: Get encryption key
  const encryptionKey = getOrCreateDatabaseKey();
  log.debug('Database encryption key obtained');

  // Step 3: Resolve database path
  const finalDbPath = options.dbPath || getDbPath();

  // Ensure parent directory exists
  const dbDir = path.dirname(finalDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    log.debug('Database directory created', { path: dbDir });
  }

  // Step 4: Open database
  try {
    dbInstance = new Database(finalDbPath, {
      verbose: options.verbose
        ? (message?: unknown) =>
            log.debug('SQL executed', { sql: String(message).substring(0, 200) })
        : undefined,
    });

    log.debug('Database file opened', { path: finalDbPath });
  } catch (error) {
    log.error('Failed to open database file', {
      path: finalDbPath,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(
      `Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Step 5: Apply SQLCipher encryption
  // DB-007: Encryption configuration
  try {
    // Set encryption key using parameterized pragma (injection-safe)
    // Note: better-sqlite3-multiple-ciphers handles key escaping internally
    dbInstance.pragma(`key = '${escapeSqliteString(encryptionKey)}'`);
    dbInstance.pragma(`cipher = '${SQLCIPHER_CONFIG.cipher}'`);
    dbInstance.pragma(`kdf_iter = ${SQLCIPHER_CONFIG.kdfIter}`);

    log.debug('SQLCipher pragmas applied');
  } catch (error) {
    dbInstance.close();
    dbInstance = null;
    log.error('Failed to apply encryption pragmas', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Failed to configure database encryption');
  }

  // Step 6: Verify encryption is working
  try {
    // Attempt to read schema - will fail if key is incorrect
    dbInstance.exec('SELECT count(*) FROM sqlite_master');
    log.debug('Database encryption verified');
  } catch (error) {
    dbInstance.close();
    dbInstance = null;
    log.error('Database encryption verification failed - possible key mismatch', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(
      'Database encryption verification failed. ' +
        'The database may be corrupted or the encryption key may have changed.'
    );
  }

  // Step 7: Apply performance optimizations
  applyPerformancePragmas(dbInstance, options);

  // Update stored path
  dbPath = finalDbPath;

  log.info('Database initialized successfully', {
    path: finalDbPath,
    encrypted: true,
  });

  return dbInstance;
}

/**
 * Initialize database WITHOUT encryption (development mode only)
 * This allows easier debugging and database inspection during development.
 *
 * WARNING: This should NEVER be used in production!
 *
 * @param options - Optional database configuration
 * @returns Initialized database instance (unencrypted)
 */
function initializeDevelopmentDatabase(options: DatabaseOptions = {}): Database.Database {
  // Step 1: Resolve database path
  const finalDbPath = options.dbPath || getDbPath();

  // Ensure parent directory exists
  const dbDir = path.dirname(finalDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    log.debug('Database directory created', { path: dbDir });
  }

  // Step 2: Open database (no encryption)
  try {
    dbInstance = new Database(finalDbPath, {
      verbose: options.verbose
        ? (message?: unknown) =>
            log.debug('SQL executed', { sql: String(message).substring(0, 200) })
        : undefined,
    });

    log.debug('Database file opened (unencrypted)', { path: finalDbPath });
  } catch (error) {
    log.error('Failed to open database file', {
      path: finalDbPath,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(
      `Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Step 3: Verify database is accessible
  try {
    dbInstance.exec('SELECT count(*) FROM sqlite_master');
    log.debug('Database access verified');
  } catch (error) {
    dbInstance.close();
    dbInstance = null;
    log.error('Database access verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Database access verification failed. The database may be corrupted.');
  }

  // Step 4: Apply performance optimizations
  applyPerformancePragmas(dbInstance, options);

  // Update stored path
  dbPath = finalDbPath;

  log.warn('⚠️ Database initialized WITHOUT encryption - DEVELOPMENT MODE ONLY');
  log.info('Database initialized successfully', {
    path: finalDbPath,
    encrypted: false,
  });

  return dbInstance;
}

/**
 * Apply performance optimization pragmas
 *
 * @param db - Database instance
 * @param options - Configuration options
 */
function applyPerformancePragmas(db: Database.Database, options: DatabaseOptions): void {
  // WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Synchronous mode - NORMAL is a good balance of safety and performance
  db.pragma('synchronous = NORMAL');

  // Memory limit
  const memoryLimit = options.memoryLimit || DEFAULT_MEMORY_LIMIT_KB;
  db.pragma(`cache_size = -${memoryLimit}`);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Temp store in memory
  db.pragma('temp_store = MEMORY');

  log.debug('Performance pragmas applied', { memoryLimitKB: memoryLimit });
}

/**
 * Escape a string for use in SQLite PRAGMA statements
 * SEC-006: Prevent injection in pragma statements
 *
 * @param str - String to escape
 * @returns Escaped string safe for SQLite
 */
function escapeSqliteString(str: string): string {
  // Replace single quotes with two single quotes (SQLite escaping)
  return str.replace(/'/g, "''");
}

// ============================================================================
// Database Access
// ============================================================================

/**
 * Get the database instance
 * SEC-006: Returns instance configured for prepared statements
 *
 * @returns Database instance
 * @throws Error if database not initialized
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error(
      'Database not initialized. Call initializeDatabase() first. ' +
        'This typically occurs during application startup.'
    );
  }
  return dbInstance;
}

/**
 * Check if database is initialized
 *
 * @returns true if database is ready for use
 */
export function isDatabaseInitialized(): boolean {
  return dbInstance !== null;
}

// ============================================================================
// Database Health & Maintenance
// ============================================================================

/**
 * Get database health information
 *
 * @returns Health check result
 */
export function getDatabaseHealth(): DatabaseHealth {
  const db = getDatabase();
  const currentPath = getDbPath();

  // Get table count
  const tableCountResult = db
    .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table'")
    .get() as { count: number };

  // Get file size
  let sizeBytes = 0;
  try {
    const stats = fs.statSync(currentPath);
    sizeBytes = stats.size;
  } catch {
    // File might not exist yet
  }

  return {
    isOpen: true,
    isEncrypted: !isDevelopment, // Encrypted in production, unencrypted in development
    tableCount: tableCountResult.count,
    sizeBytes,
    path: currentPath,
  };
}

/**
 * Check if database encryption is enabled
 * Returns true in production, false in development mode
 *
 * @returns true if database is encrypted
 */
export function isDatabaseEncrypted(): boolean {
  return !isDevelopment;
}

/**
 * Run VACUUM to optimize database storage
 * Should be run during maintenance windows
 */
export function vacuumDatabase(): void {
  const db = getDatabase();
  log.info('Starting database VACUUM operation');

  const startTime = Date.now();
  db.exec('VACUUM');
  const duration = Date.now() - startTime;

  log.info('Database VACUUM completed', { durationMs: duration });
}

/**
 * Run integrity check on database
 *
 * @returns true if database passes integrity check
 */
export function checkDatabaseIntegrity(): boolean {
  const db = getDatabase();
  log.info('Running database integrity check');

  const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;

  const isOk = result.length === 1 && result[0].integrity_check === 'ok';

  if (isOk) {
    log.info('Database integrity check passed');
  } else {
    log.error('Database integrity check failed', { result });
  }

  return isOk;
}

// ============================================================================
// Database Lifecycle
// ============================================================================

/**
 * Close the database connection
 * Call this during application shutdown
 */
export function closeDatabase(): void {
  if (dbInstance) {
    try {
      // Checkpoint WAL before closing
      dbInstance.pragma('wal_checkpoint(TRUNCATE)');
      dbInstance.close();
      log.info('Database closed successfully');
    } catch (error) {
      log.error('Error closing database', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      dbInstance = null;
    }
  }
}

/**
 * Execute a function within a database transaction
 * Automatically commits on success, rolls back on error
 *
 * @param fn - Function to execute within transaction
 * @returns Result of the function
 */
export function withTransaction<T>(fn: () => T): T {
  const db = getDatabase();
  return db.transaction(fn)();
}

/**
 * Backup the database to a specified path
 * DB-007: Encrypted backup (backup inherits encryption)
 *
 * @param backupPath - Destination path for backup
 * @returns Promise that resolves when backup is complete
 */
export async function backupDatabase(backupPath: string): Promise<void> {
  const db = getDatabase();

  // Validate backup path
  if (!path.isAbsolute(backupPath)) {
    throw new Error('Backup path must be absolute');
  }

  // Ensure backup directory exists
  const backupDir = path.dirname(backupPath);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  log.info('Starting database backup', { destination: backupPath });

  // better-sqlite3 backup() returns a Promise<BackupMetadata>
  await db.backup(backupPath);

  log.info('Database backup completed', { destination: backupPath });
}
