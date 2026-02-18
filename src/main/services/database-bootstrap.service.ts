/**
 * Database Bootstrap Service
 *
 * Enterprise-grade database initialization orchestration with:
 * - Pre-migration backup (DB-005)
 * - Transactional migrations (DB-003)
 * - Health validation post-initialization
 * - Graceful degradation on failure
 * - Structured logging (LM-001)
 * - Centralized error handling (API-003)
 *
 * @module main/services/database-bootstrap
 * @security DB-005: Backup before migrations
 * @security DB-007: Encrypted database initialization
 * @security LM-001: Structured logging with no secrets
 * @security API-003: Centralized error handling
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import {
  initializeDatabase,
  isDatabaseInitialized,
  getDatabase,
  getDatabaseHealth,
  checkDatabaseIntegrity,
  backupDatabase,
  closeDatabase,
  getDbPath,
} from './database.service';
import {
  runMigrations,
  getCurrentSchemaVersion,
  type MigrationSummary,
} from './migration.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Bootstrap initialization result
 */
export interface BootstrapResult {
  /** Whether initialization was successful */
  success: boolean;
  /** Correlation ID for error tracking (API-003) */
  correlationId: string;
  /** Database state after initialization */
  state: DatabaseState;
  /** Migration summary if migrations were run */
  migrations?: MigrationSummary;
  /** Error information if failed (sanitized for external use) */
  error?: BootstrapError;
  /** Total initialization duration in milliseconds */
  durationMs: number;
}

/**
 * Database operational state
 */
export type DatabaseState =
  | 'uninitialized'
  | 'initializing'
  | 'migrating'
  | 'validating'
  | 'ready'
  | 'degraded'
  | 'failed';

/**
 * Bootstrap error (sanitized for external consumption per API-003)
 */
export interface BootstrapError {
  /** Error code for programmatic handling */
  code: BootstrapErrorCode;
  /** User-friendly message (no stack traces or internal details) */
  message: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
  /** Suggested recovery action */
  recoveryAction?: string;
}

/**
 * Bootstrap error codes
 */
export type BootstrapErrorCode =
  | 'ENCRYPTION_UNAVAILABLE'
  | 'DISK_SPACE_INSUFFICIENT'
  | 'DATABASE_LOCKED'
  | 'DATABASE_CORRUPTED'
  | 'MIGRATION_FAILED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'BACKUP_FAILED'
  | 'INITIALIZATION_TIMEOUT'
  | 'UNKNOWN_ERROR';

/**
 * Bootstrap configuration options
 */
export interface BootstrapOptions {
  /** Timeout for initialization in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Skip pre-migration backup (NOT recommended for production) */
  skipBackup?: boolean;
  /** Force re-initialization even if already initialized */
  force?: boolean;
  /** Minimum required disk space in bytes (default: 100MB) */
  minDiskSpaceBytes?: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Overall health status */
  healthy: boolean;
  /** Individual check results */
  checks: {
    connection: boolean;
    integrity: boolean;
    schemaVersion: number;
    tableCount: number;
    requiredTablesPresent: boolean;
  };
  /** Error details if unhealthy */
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default initialization timeout */
const DEFAULT_TIMEOUT_MS = 30000;

/** Default minimum disk space (100MB) */
const DEFAULT_MIN_DISK_SPACE_BYTES = 100 * 1024 * 1024;

/** Maximum backup files to retain */
const MAX_BACKUP_FILES = 5;

/** Required tables that must exist after migration */
const REQUIRED_TABLES = [
  'stores',
  'users',
  'shifts',
  'day_summaries',
  'transactions',
  'sync_queue',
  'processed_files',
  'schema_migrations',
] as const;

// ============================================================================
// Logger (LM-001)
// ============================================================================

const log = createLogger('database-bootstrap');

// ============================================================================
// State Management
// ============================================================================

/** Current database state */
let currentState: DatabaseState = 'uninitialized';

/** Bootstrap correlation ID for current session */
let sessionCorrelationId: string | null = null;

/**
 * Get current database state
 */
export function getDatabaseState(): DatabaseState {
  return currentState;
}

/**
 * Check if database is ready for operations
 */
export function isDatabaseReady(): boolean {
  return currentState === 'ready';
}

/**
 * Set database state with logging
 */
function setState(newState: DatabaseState, correlationId: string): void {
  const previousState = currentState;
  currentState = newState;
  log.info('Database state changed', {
    correlationId,
    previousState,
    newState,
  });
}

// ============================================================================
// Pre-flight Checks
// ============================================================================

/**
 * Check available disk space
 * @returns Available space in bytes, or -1 if cannot determine
 */
function getAvailableDiskSpace(dbPath: string): number {
  try {
    const dir = path.dirname(dbPath);
    // On Windows, use fs.statfsSync if available (Node 18.15+)
    // Fallback to assuming sufficient space if API not available
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(dir);
      return stats.bavail * stats.bsize;
    }
    // Cannot determine - return -1 to skip check
    return -1;
  } catch {
    return -1;
  }
}

/**
 * Validate pre-flight conditions
 */
function validatePreflightConditions(
  options: BootstrapOptions,
  correlationId: string
): BootstrapError | null {
  const dbPath = getDbPath();
  const minSpace = options.minDiskSpaceBytes ?? DEFAULT_MIN_DISK_SPACE_BYTES;

  // Check disk space
  const availableSpace = getAvailableDiskSpace(dbPath);
  if (availableSpace !== -1 && availableSpace < minSpace) {
    log.error('Insufficient disk space', {
      correlationId,
      availableBytes: availableSpace,
      requiredBytes: minSpace,
    });
    return {
      code: 'DISK_SPACE_INSUFFICIENT',
      message: 'Insufficient disk space for database operations.',
      recoverable: true,
      recoveryAction: 'Free up disk space and restart the application.',
    };
  }

  // Check write permissions
  const dbDir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    // Test write access
    const testFile = path.join(dbDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (error) {
    log.error('Database directory not writable', {
      correlationId,
      path: dbDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      code: 'UNKNOWN_ERROR',
      message: 'Cannot write to database directory.',
      recoverable: false,
      recoveryAction: 'Check file permissions for the application data folder.',
    };
  }

  return null;
}

// ============================================================================
// Backup Management (DB-005)
// ============================================================================

/**
 * Get backup directory path
 */
function getBackupDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'backups');
}

/**
 * Create pre-migration backup
 * DB-005: Encrypt backups and store in dedicated locations
 */
async function createPreMigrationBackup(correlationId: string): Promise<string | null> {
  const dbPath = getDbPath();

  // Skip if database doesn't exist yet
  if (!fs.existsSync(dbPath)) {
    log.debug('No existing database to backup', { correlationId });
    return null;
  }

  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const schemaVersion = isDatabaseInitialized() ? getCurrentSchemaVersion() : 0;
  const backupFileName = `nuvana_v${schemaVersion}_${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFileName);

  log.info('Creating pre-migration backup', {
    correlationId,
    schemaVersion,
    backupPath,
  });

  try {
    await backupDatabase(backupPath);

    // Verify backup was created and has size
    const backupStats = fs.statSync(backupPath);
    if (backupStats.size === 0) {
      throw new Error('Backup file is empty');
    }

    log.info('Pre-migration backup completed', {
      correlationId,
      backupPath,
      sizeBytes: backupStats.size,
    });

    // Rotate old backups
    await rotateBackups(correlationId);

    return backupPath;
  } catch (error) {
    log.error('Pre-migration backup failed', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Rotate old backups to maintain MAX_BACKUP_FILES limit
 * DB-005: Configure retention policies
 */
async function rotateBackups(correlationId: string): Promise<void> {
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    return;
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('nuvana_') && f.endsWith('.db'))
    .map((f) => ({
      name: f,
      path: path.join(backupDir, f),
      mtime: fs.statSync(path.join(backupDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime); // Newest first

  if (files.length > MAX_BACKUP_FILES) {
    const toDelete = files.slice(MAX_BACKUP_FILES);
    for (const file of toDelete) {
      try {
        fs.unlinkSync(file.path);
        log.debug('Deleted old backup', { correlationId, file: file.name });
      } catch (error) {
        log.warn('Failed to delete old backup', {
          correlationId,
          file: file.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Validate database schema after migrations
 */
function validateSchema(correlationId: string): BootstrapError | null {
  const db = getDatabase();

  // Get all table names
  const tablesResult = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;

  const tableNames = new Set(tablesResult.map((t) => t.name));

  // Check required tables exist
  const missingTables: string[] = [];
  for (const requiredTable of REQUIRED_TABLES) {
    if (!tableNames.has(requiredTable)) {
      missingTables.push(requiredTable);
    }
  }

  if (missingTables.length > 0) {
    log.error('Schema validation failed - missing tables', {
      correlationId,
      missingTables,
    });
    return {
      code: 'SCHEMA_VALIDATION_FAILED',
      message: 'Database schema is incomplete. Some required tables are missing.',
      recoverable: false,
      recoveryAction: 'Delete the database file and restart to recreate the schema.',
    };
  }

  log.info('Schema validation passed', {
    correlationId,
    tableCount: tableNames.size,
  });

  return null;
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Perform comprehensive health check
 */
export function performHealthCheck(): HealthCheckResult {
  if (!isDatabaseInitialized()) {
    return {
      healthy: false,
      checks: {
        connection: false,
        integrity: false,
        schemaVersion: 0,
        tableCount: 0,
        requiredTablesPresent: false,
      },
      error: 'Database not initialized',
    };
  }

  try {
    const db = getDatabase();

    // Test connection with simple query
    const connectionTest = db.prepare('SELECT 1 as result').get() as { result: number };
    const connectionOk = connectionTest?.result === 1;

    // Run integrity check
    const integrityOk = checkDatabaseIntegrity();

    // Get schema version
    const schemaVersion = getCurrentSchemaVersion();

    // Get health info
    const health = getDatabaseHealth();

    // Check required tables
    const tablesResult = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tablesResult.map((t) => t.name));
    const requiredTablesPresent = REQUIRED_TABLES.every((t) => tableNames.has(t));

    const healthy = connectionOk && integrityOk && requiredTablesPresent;

    return {
      healthy,
      checks: {
        connection: connectionOk,
        integrity: integrityOk,
        schemaVersion,
        tableCount: health.tableCount,
        requiredTablesPresent,
      },
    };
  } catch (error) {
    return {
      healthy: false,
      checks: {
        connection: false,
        integrity: false,
        schemaVersion: 0,
        tableCount: 0,
        requiredTablesPresent: false,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Main Bootstrap Function
// ============================================================================

/**
 * Bootstrap the database with enterprise-grade initialization
 *
 * Sequence:
 * 1. Pre-flight validation (disk space, permissions)
 * 2. Initialize encrypted database (DB-007)
 * 3. Create pre-migration backup (DB-005)
 * 4. Run pending migrations (DB-003)
 * 5. Validate schema
 * 6. Health check
 * 7. Set ready state
 *
 * @param options - Bootstrap configuration
 * @returns Bootstrap result with success/failure details
 */
export async function bootstrapDatabase(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const correlationId = randomUUID();
  sessionCorrelationId = correlationId;
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  log.info('Starting database bootstrap', {
    correlationId,
    timeoutMs,
    skipBackup: options.skipBackup ?? false,
  });

  // Check if already initialized
  if (isDatabaseInitialized() && !options.force) {
    log.info('Database already initialized', { correlationId });
    setState('ready', correlationId);
    return {
      success: true,
      correlationId,
      state: 'ready',
      durationMs: Date.now() - startTime,
    };
  }

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('INITIALIZATION_TIMEOUT'));
    }, timeoutMs);
  });

  try {
    // Race against timeout
    const result = await Promise.race([executeBootstrap(correlationId, options), timeoutPromise]);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage === 'INITIALIZATION_TIMEOUT') {
      log.error('Database initialization timed out', {
        correlationId,
        timeoutMs,
      });
      setState('failed', correlationId);
      return {
        success: false,
        correlationId,
        state: 'failed',
        error: {
          code: 'INITIALIZATION_TIMEOUT',
          message: 'Database initialization timed out.',
          recoverable: true,
          recoveryAction: 'Restart the application.',
        },
        durationMs: Date.now() - startTime,
      };
    }

    // Unexpected error
    log.error('Database bootstrap failed with unexpected error', {
      correlationId,
      error: errorMessage,
    });
    setState('failed', correlationId);
    return {
      success: false,
      correlationId,
      state: 'failed',
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred during database initialization.',
        recoverable: false,
      },
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute the bootstrap sequence
 */
async function executeBootstrap(
  correlationId: string,
  options: BootstrapOptions
): Promise<BootstrapResult> {
  const startTime = Date.now();

  // Step 1: Pre-flight validation
  setState('initializing', correlationId);
  const preflightError = validatePreflightConditions(options, correlationId);
  if (preflightError) {
    setState('failed', correlationId);
    return {
      success: false,
      correlationId,
      state: 'failed',
      error: preflightError,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 2: Initialize encrypted database
  try {
    initializeDatabase();
    log.info('Encrypted database initialized', { correlationId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Database initialization failed', {
      correlationId,
      error: errorMessage,
    });

    let errorCode: BootstrapErrorCode = 'UNKNOWN_ERROR';
    let message = 'Failed to initialize database.';
    let recoverable = false;

    if (errorMessage.includes('SafeStorage')) {
      errorCode = 'ENCRYPTION_UNAVAILABLE';
      message = 'System encryption is not available.';
      recoverable = false;
    } else if (errorMessage.includes('locked') || errorMessage.includes('SQLITE_BUSY')) {
      errorCode = 'DATABASE_LOCKED';
      message = 'Database is locked by another process.';
      recoverable = true;
    } else if (errorMessage.includes('corrupt') || errorMessage.includes('malformed')) {
      errorCode = 'DATABASE_CORRUPTED';
      message = 'Database file is corrupted.';
      recoverable = false;
    }

    setState('failed', correlationId);
    return {
      success: false,
      correlationId,
      state: 'failed',
      error: {
        code: errorCode,
        message,
        recoverable,
        recoveryAction: recoverable
          ? 'Close other applications and restart.'
          : 'Delete the database file and restart to recreate.',
      },
      durationMs: Date.now() - startTime,
    };
  }

  // Step 3: Create pre-migration backup (DB-005)
  if (!options.skipBackup) {
    setState('migrating', correlationId);
    try {
      await createPreMigrationBackup(correlationId);
    } catch (error) {
      log.error('Pre-migration backup failed', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Continue without backup - log warning but don't fail
      // In strict mode, this could be made fatal
      log.warn('Continuing without backup - NOT RECOMMENDED for production', {
        correlationId,
      });
    }
  }

  // Step 4: Run migrations
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  let migrationSummary: MigrationSummary;

  try {
    migrationSummary = runMigrations(migrationsDir);

    if (migrationSummary.failed) {
      log.error('Migration failed', {
        correlationId,
        failedMigration: migrationSummary.failed,
      });
      setState('failed', correlationId);
      return {
        success: false,
        correlationId,
        state: 'failed',
        migrations: migrationSummary,
        error: {
          code: 'MIGRATION_FAILED',
          message: `Database migration failed: ${migrationSummary.failed.name}`,
          recoverable: false,
          recoveryAction: 'Restore from backup and contact support.',
        },
        durationMs: Date.now() - startTime,
      };
    }

    log.info('Migrations completed', {
      correlationId,
      applied: migrationSummary.applied.length,
      skipped: migrationSummary.skipped.length,
    });
  } catch (error) {
    log.error('Migration execution error', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    setState('failed', correlationId);
    return {
      success: false,
      correlationId,
      state: 'failed',
      error: {
        code: 'MIGRATION_FAILED',
        message: 'Failed to execute database migrations.',
        recoverable: false,
        recoveryAction: 'Restore from backup and contact support.',
      },
      durationMs: Date.now() - startTime,
    };
  }

  // Step 5: Validate schema
  setState('validating', correlationId);
  const schemaError = validateSchema(correlationId);
  if (schemaError) {
    setState('failed', correlationId);
    return {
      success: false,
      correlationId,
      state: 'failed',
      migrations: migrationSummary,
      error: schemaError,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 6: Health check
  const healthResult = performHealthCheck();
  if (!healthResult.healthy) {
    log.error('Post-initialization health check failed', {
      correlationId,
      checks: healthResult.checks,
      error: healthResult.error,
    });
    setState('degraded', correlationId);
    return {
      success: false,
      correlationId,
      state: 'degraded',
      migrations: migrationSummary,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'Database health check failed after initialization.',
        recoverable: false,
        recoveryAction: 'Delete the database file and restart.',
      },
      durationMs: Date.now() - startTime,
    };
  }

  // Step 7: Set ready state
  setState('ready', correlationId);
  log.info('Database bootstrap completed successfully', {
    correlationId,
    schemaVersion: getCurrentSchemaVersion(),
    tableCount: healthResult.checks.tableCount,
    durationMs: Date.now() - startTime,
  });

  return {
    success: true,
    correlationId,
    state: 'ready',
    migrations: migrationSummary,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Shutdown
// ============================================================================

/**
 * Gracefully shutdown database
 */
export function shutdownDatabase(): void {
  const correlationId = sessionCorrelationId ?? randomUUID();
  log.info('Shutting down database', { correlationId });

  try {
    closeDatabase();
    setState('uninitialized', correlationId);
    log.info('Database shutdown complete', { correlationId });
  } catch (error) {
    log.error('Error during database shutdown', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ============================================================================
// Recovery
// ============================================================================

/**
 * Get available backup files for recovery
 */
export function getAvailableBackups(): Array<{
  fileName: string;
  filePath: string;
  version: number;
  timestamp: string;
  sizeBytes: number;
}> {
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const backupPattern = /^nuvana_v(\d+)_(.+)\.db$/;

  return fs
    .readdirSync(backupDir)
    .filter((f) => backupPattern.test(f))
    .map((f) => {
      const match = f.match(backupPattern)!;
      const filePath = path.join(backupDir, f);
      const stats = fs.statSync(filePath);
      return {
        fileName: f,
        filePath,
        version: parseInt(match[1], 10),
        timestamp: match[2].replace(/-/g, ':').replace('T', ' '),
        sizeBytes: stats.size,
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes); // Sort by size (proxy for recency)
}

/**
 * Restore database from backup
 * @param backupPath - Path to backup file
 * @returns Success status
 */
export async function restoreFromBackup(backupPath: string): Promise<boolean> {
  const correlationId = randomUUID();
  log.info('Restoring database from backup', {
    correlationId,
    backupPath,
  });

  if (!fs.existsSync(backupPath)) {
    log.error('Backup file not found', { correlationId, backupPath });
    return false;
  }

  const dbPath = getDbPath();

  try {
    // Close current database if open
    if (isDatabaseInitialized()) {
      closeDatabase();
    }

    // Remove current database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    // Copy backup to database location
    fs.copyFileSync(backupPath, dbPath);

    log.info('Database restored from backup', {
      correlationId,
      backupPath,
    });

    return true;
  } catch (error) {
    log.error('Failed to restore from backup', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}
