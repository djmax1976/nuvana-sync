/**
 * Test Database Factory
 *
 * Creates isolated SQLite databases for integration tests.
 * Each test gets a fresh database with all migrations applied.
 *
 * @module tests/helpers/test-database
 *
 * Security Compliance:
 * - SEC-006: All SQL via parameterized queries (inherited from migration service)
 * - DB-006: Test databases use store_id for tenant isolation
 * - DB-001: Uses same migration patterns as production
 *
 * Performance Considerations:
 * - Uses in-memory or temp-file SQLite for speed
 * - Migrations are cached for fast re-application
 * - Each test gets isolated database (no cleanup between tests needed)
 */

import Database from 'better-sqlite3-multiple-ciphers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

/**
 * Test database context returned by factory
 */
export interface TestDatabaseContext {
  /** SQLite database instance */
  db: Database.Database;
  /** Path to database file (empty string for in-memory) */
  dbPath: string;
  /** Cleanup function - call in afterEach */
  cleanup: () => void;
  /** Store ID created during setup */
  storeId: string;
}

/**
 * Options for creating test database
 */
export interface TestDatabaseOptions {
  /** Use in-memory database (faster, default: true) */
  inMemory?: boolean;
  /** Store ID to use (default: auto-generated) */
  storeId?: string;
  /** Store name (default: 'Test Store') */
  storeName?: string;
  /** Company ID (default: 'test-company-id') */
  companyId?: string;
  /** Timezone (default: 'America/New_York') */
  timezone?: string;
  /** Skip running migrations (for specific test scenarios) */
  skipMigrations?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Cache for migration SQL content */
let migrationCache: Map<number, { name: string; sql: string }> | null = null;

/** Path to migrations directory relative to project root */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/main/migrations');

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Load all migrations from the migrations directory
 * Caches results for performance on subsequent calls
 *
 * @returns Map of version -> { name, sql }
 */
function loadMigrations(): Map<number, { name: string; sql: string }> {
  if (migrationCache) {
    return migrationCache;
  }

  migrationCache = new Map();

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    return migrationCache;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR);
  const migrationPattern = /^v(\d{3})_(.+)\.sql$/;

  for (const file of files) {
    const match = file.match(migrationPattern);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const name = match[2].replace(/_/g, ' ');
    const filePath = path.join(MIGRATIONS_DIR, file);

    try {
      const sql = fs.readFileSync(filePath, 'utf-8');
      migrationCache.set(version, { name, sql });
    } catch {
      console.warn(`Failed to read migration file: ${file}`);
    }
  }

  return migrationCache;
}

/**
 * Apply all migrations to a database
 *
 * @param db - Database instance
 */
function applyMigrations(db: Database.Database): void {
  // Create migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT
    )
  `);

  // Load and apply migrations in order
  const migrations = loadMigrations();
  const versions = Array.from(migrations.keys()).sort((a, b) => a - b);

  for (const version of versions) {
    const migration = migrations.get(version);
    if (!migration) continue;

    // SEC-006: Parameterized check
    const existsStmt = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    if (existsStmt.get(version)) continue;

    // Apply migration in transaction
    const transaction = db.transaction(() => {
      db.exec(migration.sql);

      // SEC-006: Parameterized insert
      const insertStmt = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
      insertStmt.run(version, migration.name);
    });

    transaction();
  }
}

/**
 * Apply performance pragmas to test database
 *
 * @param db - Database instance
 */
function applyPerformancePragmas(db: Database.Database): void {
  // WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  // NORMAL sync for balance of safety and speed
  db.pragma('synchronous = NORMAL');
  // Memory cache
  db.pragma('cache_size = -64000'); // 64MB
  // Foreign keys enabled
  db.pragma('foreign_keys = ON');
  // Temp store in memory
  db.pragma('temp_store = MEMORY');
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an isolated test database with all migrations applied
 *
 * Usage:
 * ```typescript
 * let ctx: TestDatabaseContext;
 *
 * beforeEach(async () => {
 *   ctx = await createTestDatabase();
 * });
 *
 * afterEach(() => {
 *   ctx.cleanup();
 * });
 *
 * it('should do something', () => {
 *   // Use ctx.db for database operations
 *   // ctx.storeId is available for store-scoped queries
 * });
 * ```
 *
 * @param options - Configuration options
 * @returns Test database context
 */
export async function createTestDatabase(
  options: TestDatabaseOptions = {}
): Promise<TestDatabaseContext> {
  const {
    inMemory = true,
    storeId = `test-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    storeName = 'Test Store',
    companyId = 'test-company-id',
    timezone = 'America/New_York',
    skipMigrations = false,
  } = options;

  let db: Database.Database;
  let dbPath: string;
  let testDir: string | null = null;

  if (inMemory) {
    // In-memory database for fastest tests
    db = new Database(':memory:');
    dbPath = ':memory:';
  } else {
    // File-based database for tests that need persistence
    testDir = path.join(
      os.tmpdir(),
      `nuvana-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'test.db');
    db = new Database(dbPath);
  }

  // Apply performance pragmas
  applyPerformancePragmas(db);

  // Apply migrations unless skipped
  if (!skipMigrations) {
    applyMigrations(db);
  }

  // Seed the store (required for all store-scoped operations)
  // SEC-006: Parameterized insert
  const insertStoreStmt = db.prepare(`
    INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
  `);
  insertStoreStmt.run(storeId, companyId, storeName, timezone);

  // Cleanup function
  const cleanup = (): void => {
    try {
      if (db.open) {
        db.close();
      }
    } catch {
      // Ignore close errors
    }

    if (testDir && fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  return {
    db,
    dbPath,
    cleanup,
    storeId,
  };
}

/**
 * Create a test database synchronously (for simpler test setup)
 *
 * @param options - Configuration options
 * @returns Test database context
 */
export function createTestDatabaseSync(options: TestDatabaseOptions = {}): TestDatabaseContext {
  const {
    inMemory = true,
    storeId = `test-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    storeName = 'Test Store',
    companyId = 'test-company-id',
    timezone = 'America/New_York',
    skipMigrations = false,
  } = options;

  let db: Database.Database;
  let dbPath: string;
  let testDir: string | null = null;

  if (inMemory) {
    db = new Database(':memory:');
    dbPath = ':memory:';
  } else {
    testDir = path.join(
      os.tmpdir(),
      `nuvana-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'test.db');
    db = new Database(dbPath);
  }

  applyPerformancePragmas(db);

  if (!skipMigrations) {
    applyMigrations(db);
  }

  // Seed the store
  const insertStoreStmt = db.prepare(`
    INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
  `);
  insertStoreStmt.run(storeId, companyId, storeName, timezone);

  const cleanup = (): void => {
    try {
      if (db.open) {
        db.close();
      }
    } catch {
      // Ignore
    }

    if (testDir && fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  };

  return {
    db,
    dbPath,
    cleanup,
    storeId,
  };
}

/**
 * Clear the migration cache (useful for tests that modify migrations)
 */
export function clearMigrationCache(): void {
  migrationCache = null;
}

/**
 * Get the count of available migrations
 * Useful for validation in tests
 */
export function getMigrationCount(): number {
  const migrations = loadMigrations();
  return migrations.size;
}

/**
 * Verify database schema by checking required tables exist
 *
 * @param db - Database instance
 * @returns Object with validation result
 */
export function verifyDatabaseSchema(db: Database.Database): {
  valid: boolean;
  missingTables: string[];
  tableCount: number;
} {
  const requiredTables = [
    'stores',
    'users',
    'shifts',
    'day_summaries',
    'transactions',
    'sync_queue',
    'processed_files',
    'schema_migrations',
  ];

  // Get all tables
  const tablesStmt = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  const tables = tablesStmt.all() as Array<{ name: string }>;
  const tableNames = new Set(tables.map((t) => t.name));

  const missingTables = requiredTables.filter((t) => !tableNames.has(t));

  return {
    valid: missingTables.length === 0,
    missingTables,
    tableCount: tables.length,
  };
}
