/**
 * Migration Service
 *
 * Schema versioning and migration management for SQLite database.
 * Implements transactional migrations with rollback on failure.
 *
 * @module main/services/migration
 * @security SEC-006: All SQL via parameterized queries
 * @security DB-001: ORM/prepared statement patterns
 */

import { getDatabase } from './database.service';
import { createLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration definition
 */
export interface Migration {
  /** Unique version number (must be sequential) */
  version: number;
  /** Human-readable migration name */
  name: string;
  /** SQL statements to execute */
  sql: string;
}

/**
 * Applied migration record
 */
export interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  version: number;
  name: string;
  error?: string;
  durationMs: number;
}

/**
 * Migration run summary
 */
export interface MigrationSummary {
  applied: MigrationResult[];
  skipped: number[];
  failed: MigrationResult | null;
  totalDurationMs: number;
}

// ============================================================================
// Constants
// ============================================================================

const MIGRATION_TABLE = 'schema_migrations';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('migration');

// ============================================================================
// Migration Table Management
// ============================================================================

/**
 * Initialize the schema_migrations tracking table
 * Creates table if it doesn't exist
 *
 * SEC-006: Uses static SQL (no user input)
 */
export function initializeMigrationTable(): void {
  const db = getDatabase();

  // Create migrations tracking table
  // This is static SQL with no user input
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT
    )
  `);

  log.debug('Migration table initialized');
}

/**
 * Get list of already applied migration versions
 *
 * @returns Array of applied migration version numbers
 */
export function getAppliedMigrations(): number[] {
  const db = getDatabase();

  // SEC-006: Prepared statement with no parameters
  const stmt = db.prepare(`
    SELECT version
    FROM ${MIGRATION_TABLE}
    ORDER BY version ASC
  `);

  const rows = stmt.all() as Array<{ version: number }>;
  return rows.map((row) => row.version);
}

/**
 * Get full details of applied migrations
 *
 * @returns Array of applied migration records
 */
export function getAppliedMigrationDetails(): AppliedMigration[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT version, name, applied_at
    FROM ${MIGRATION_TABLE}
    ORDER BY version ASC
  `);

  return stmt.all() as AppliedMigration[];
}

/**
 * Get the current schema version
 *
 * @returns Latest applied migration version, or 0 if none applied
 */
export function getCurrentSchemaVersion(): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT MAX(version) as version
    FROM ${MIGRATION_TABLE}
  `);

  const result = stmt.get() as { version: number | null };
  return result.version ?? 0;
}

// ============================================================================
// Migration Execution
// ============================================================================

/**
 * Calculate checksum for migration SQL
 *
 * @param sql - Migration SQL content
 * @returns MD5-like checksum string
 */
function calculateChecksum(sql: string): string {
  // Simple checksum using string hash
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Apply a single migration within a transaction
 * DB-001: Transactional migration with automatic rollback
 *
 * @param migration - Migration to apply
 * @returns Migration result
 */
export function applyMigration(migration: Migration): MigrationResult {
  const db = getDatabase();
  const startTime = Date.now();

  log.info('Applying migration', {
    version: migration.version,
    name: migration.name,
  });

  // Check if migration needs FK constraints disabled
  // PRAGMA foreign_keys must be set OUTSIDE transactions to take effect
  const needsFkDisabled =
    migration.sql.includes('PRAGMA defer_foreign_keys') ||
    migration.sql.includes('PRAGMA foreign_keys') ||
    migration.sql.includes('-- FK_SENSITIVE');

  try {
    // Calculate checksum before applying
    const checksum = calculateChecksum(migration.sql);

    // Disable FK constraints BEFORE transaction if needed
    // This is required because PRAGMA foreign_keys cannot be changed inside a transaction
    if (needsFkDisabled) {
      log.debug('Disabling FK constraints for migration', { version: migration.version });
      db.pragma('foreign_keys = OFF');
    }

    try {
      // Execute migration within transaction
      // DB-001: Automatic rollback on any error
      const transaction = db.transaction(() => {
        // Execute migration SQL (strip out any PRAGMA statements since we handle them outside)
        const cleanedSql = migration.sql
          .replace(
            /PRAGMA\s+defer_foreign_keys\s*=\s*\w+\s*;?/gi,
            '-- (FK pragma handled by migration service)'
          )
          .replace(
            /PRAGMA\s+foreign_keys\s*=\s*\w+\s*;?/gi,
            '-- (FK pragma handled by migration service)'
          );

        db.exec(cleanedSql);

        // Record migration in tracking table
        // SEC-006: Parameterized insert
        const insertStmt = db.prepare(`
          INSERT INTO ${MIGRATION_TABLE} (version, name, checksum)
          VALUES (?, ?, ?)
        `);

        insertStmt.run(migration.version, migration.name, checksum);
      });

      transaction();
    } finally {
      // Re-enable FK constraints AFTER transaction
      if (needsFkDisabled) {
        log.debug('Re-enabling FK constraints after migration', { version: migration.version });
        db.pragma('foreign_keys = ON');
      }
    }

    const durationMs = Date.now() - startTime;

    log.info('Migration applied successfully', {
      version: migration.version,
      name: migration.name,
      durationMs,
    });

    return {
      success: true,
      version: migration.version,
      name: migration.name,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    log.error('Migration failed', {
      version: migration.version,
      name: migration.name,
      error: errorMessage,
      durationMs,
    });

    // Ensure FK constraints are re-enabled even on failure
    if (needsFkDisabled) {
      try {
        db.pragma('foreign_keys = ON');
      } catch {
        // Ignore errors re-enabling FKs
      }
    }

    return {
      success: false,
      version: migration.version,
      name: migration.name,
      error: errorMessage,
      durationMs,
    };
  }
}

/**
 * Check if a migration has already been applied
 *
 * @param version - Migration version to check
 * @returns true if migration was already applied
 */
export function isMigrationApplied(version: number): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT 1 FROM ${MIGRATION_TABLE} WHERE version = ?
  `);

  const result = stmt.get(version);
  return result !== undefined;
}

// ============================================================================
// Migration Loading
// ============================================================================

/**
 * Load migrations from SQL files in a directory
 * Files must be named: v###_name.sql (e.g., v001_core_tables.sql)
 *
 * @param migrationsDir - Directory containing migration files
 * @returns Array of migrations sorted by version
 */
export function loadMigrationsFromDirectory(migrationsDir: string): Migration[] {
  if (!fs.existsSync(migrationsDir)) {
    log.warn('Migrations directory does not exist', { path: migrationsDir });
    return [];
  }

  const files = fs.readdirSync(migrationsDir);
  const migrations: Migration[] = [];

  // Match files like v001_core_tables.sql
  const migrationPattern = /^v(\d{3})_(.+)\.sql$/;

  for (const file of files) {
    const match = file.match(migrationPattern);
    if (!match) {
      log.debug('Skipping non-migration file', { file });
      continue;
    }

    const version = parseInt(match[1], 10);
    const name = match[2].replace(/_/g, ' ');
    const filePath = path.join(migrationsDir, file);

    try {
      const sql = fs.readFileSync(filePath, 'utf-8');

      migrations.push({
        version,
        name,
        sql,
      });

      log.debug('Migration loaded', { version, name, file });
    } catch (error) {
      log.error('Failed to read migration file', {
        file,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Sort by version
  migrations.sort((a, b) => a.version - b.version);

  // Validate sequential versions
  for (let i = 0; i < migrations.length; i++) {
    if (migrations[i].version !== i + 1) {
      log.warn('Non-sequential migration version detected', {
        expected: i + 1,
        actual: migrations[i].version,
      });
    }
  }

  return migrations;
}

// ============================================================================
// Migration Runner
// ============================================================================

/**
 * Run all pending migrations from a directory
 *
 * @param migrationsDir - Directory containing migration SQL files
 * @returns Summary of migration run
 */
export function runMigrations(migrationsDir: string): MigrationSummary {
  const startTime = Date.now();

  log.info('Starting migration run', { migrationsDir });

  // Initialize tracking table
  initializeMigrationTable();

  // Get applied migrations
  const applied = getAppliedMigrations();
  const appliedSet = new Set(applied);

  // Load available migrations
  const migrations = loadMigrationsFromDirectory(migrationsDir);

  const summary: MigrationSummary = {
    applied: [],
    skipped: [],
    failed: null,
    totalDurationMs: 0,
  };

  // Apply pending migrations in order
  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) {
      summary.skipped.push(migration.version);
      log.debug('Skipping already applied migration', {
        version: migration.version,
      });
      continue;
    }

    const result = applyMigration(migration);

    if (result.success) {
      summary.applied.push(result);
    } else {
      summary.failed = result;
      // Stop on first failure
      break;
    }
  }

  summary.totalDurationMs = Date.now() - startTime;

  log.info('Migration run completed', {
    applied: summary.applied.length,
    skipped: summary.skipped.length,
    failed: summary.failed !== null,
    totalDurationMs: summary.totalDurationMs,
  });

  return summary;
}

/**
 * Run migrations from an array of migration objects
 * Useful for embedded migrations or testing
 *
 * @param migrations - Array of migrations to run
 * @returns Summary of migration run
 */
export function runMigrationsFromArray(migrations: Migration[]): MigrationSummary {
  const startTime = Date.now();

  log.info('Starting migration run from array', {
    count: migrations.length,
  });

  // Initialize tracking table
  initializeMigrationTable();

  // Get applied migrations
  const applied = getAppliedMigrations();
  const appliedSet = new Set(applied);

  // Sort migrations by version
  const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

  const summary: MigrationSummary = {
    applied: [],
    skipped: [],
    failed: null,
    totalDurationMs: 0,
  };

  // Apply pending migrations in order
  for (const migration of sortedMigrations) {
    if (appliedSet.has(migration.version)) {
      summary.skipped.push(migration.version);
      continue;
    }

    const result = applyMigration(migration);

    if (result.success) {
      summary.applied.push(result);
    } else {
      summary.failed = result;
      break;
    }
  }

  summary.totalDurationMs = Date.now() - startTime;

  log.info('Migration run completed', {
    applied: summary.applied.length,
    skipped: summary.skipped.length,
    failed: summary.failed !== null,
  });

  return summary;
}

/**
 * Validate that all expected migrations are applied
 *
 * @param expectedVersions - Array of version numbers that should be applied
 * @returns Object indicating validation result
 */
export function validateMigrations(expectedVersions: number[]): {
  valid: boolean;
  missing: number[];
  extra: number[];
} {
  const applied = new Set(getAppliedMigrations());
  const expected = new Set(expectedVersions);

  const missing = expectedVersions.filter((v) => !applied.has(v));
  const extra = [...applied].filter((v) => !expected.has(v));

  return {
    valid: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}
