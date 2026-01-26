/**
 * Service Test Context
 *
 * Provides a unified context for integration tests with:
 * - Real SQLite database with all migrations
 * - Pre-seeded store data
 * - Easy access to test data seeders
 * - Automatic cleanup
 *
 * @module tests/helpers/test-context
 *
 * Security Compliance:
 * - SEC-006: All SQL via parameterized queries
 * - DB-006: Store-scoped data for tenant isolation
 * - Follows enterprise-grade testing patterns
 *
 * Usage:
 * ```typescript
 * import { createServiceTestContext, ServiceTestContext } from '../../helpers/test-context';
 *
 * describe('MyService (Integration)', () => {
 *   let ctx: ServiceTestContext;
 *
 *   beforeEach(async () => {
 *     ctx = await createServiceTestContext();
 *   });
 *
 *   afterEach(() => {
 *     ctx.cleanup();
 *   });
 *
 *   it('should work with real database', () => {
 *     const user = ctx.seeders.user({ name: 'Alice' });
 *     // Test with real data
 *   });
 * });
 * ```
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDatabase,
  createTestDatabaseSync,
  type TestDatabaseContext,
  type TestDatabaseOptions,
  verifyDatabaseSchema,
} from './test-database';
import {
  seedUser,
  seedUsers,
  seedShift,
  seedDaySummary,
  seedTransaction,
  seedSyncQueueItem,
  seedProcessedFile,
  seedFullStoreData,
  hashPinForTest,
  generateBusinessDate,
  type SeedUserOptions,
  type SeedShiftOptions,
  type SeedDaySummaryOptions,
  type SeedTransactionOptions,
  type SeedSyncQueueOptions,
  type SeedProcessedFileOptions,
  type SeededUser,
  type SeededShift,
  type SeededDaySummary,
  type SeededTransaction,
  type SeededSyncQueueItem,
  type SeededProcessedFile,
} from './test-seeders';

// ============================================================================
// Types
// ============================================================================

/**
 * Seeder functions bound to the current test context
 */
export interface BoundSeeders {
  /** Seed a single user */
  user: (options?: SeedUserOptions) => SeededUser;
  /** Seed multiple users */
  users: (count: number, options?: Omit<SeedUserOptions, 'user_id'>) => SeededUser[];
  /** Seed a shift */
  shift: (options?: SeedShiftOptions) => SeededShift;
  /** Seed a day summary */
  daySummary: (options?: SeedDaySummaryOptions) => SeededDaySummary;
  /** Seed a transaction */
  transaction: (options?: SeedTransactionOptions) => SeededTransaction;
  /** Seed a sync queue item */
  syncQueueItem: (options?: SeedSyncQueueOptions) => SeededSyncQueueItem;
  /** Seed a processed file record */
  processedFile: (options?: SeedProcessedFileOptions) => SeededProcessedFile;
  /** Seed full store data (manager, cashiers, shift, transactions) */
  fullStoreData: () => ReturnType<typeof seedFullStoreData>;
}

/**
 * Service test context
 */
export interface ServiceTestContext {
  /** SQLite database instance */
  db: Database.Database;
  /** Path to database file */
  dbPath: string;
  /** Store ID for the test */
  storeId: string;
  /** Store name */
  storeName: string;
  /** Company ID */
  companyId: string;
  /** Timezone */
  timezone: string;
  /** Cleanup function - call in afterEach */
  cleanup: () => void;
  /** Bound seeder functions */
  seeders: BoundSeeders;
  /** Utility functions */
  utils: {
    /** Hash a PIN for testing */
    hashPin: (pin: string) => string;
    /** Generate a business date */
    businessDate: (daysOffset?: number) => string;
    /** Get today's business date */
    today: () => string;
  };
}

/**
 * Service test context options
 */
export interface ServiceTestContextOptions extends TestDatabaseOptions {
  /** Additional setup to run after database is created */
  setup?: (ctx: ServiceTestContext) => void | Promise<void>;
}

// ============================================================================
// Context Factory
// ============================================================================

/**
 * Create a service test context with real database
 *
 * This is the primary entry point for integration tests.
 * Provides:
 * - Isolated database with all migrations
 * - Pre-seeded store
 * - Bound seeder functions
 * - Automatic cleanup
 *
 * @param options - Configuration options
 * @returns Service test context
 *
 * @example
 * ```typescript
 * describe('AuthService (Integration)', () => {
 *   let ctx: ServiceTestContext;
 *
 *   beforeEach(async () => {
 *     ctx = await createServiceTestContext();
 *     // Seed a user for auth tests
 *     ctx.seeders.user({ name: 'TestUser', pin: '1234' });
 *   });
 *
 *   afterEach(() => ctx.cleanup());
 *
 *   it('should authenticate user with correct PIN', () => {
 *     // Test real authentication logic
 *   });
 * });
 * ```
 */
export async function createServiceTestContext(
  options: ServiceTestContextOptions = {}
): Promise<ServiceTestContext> {
  const {
    storeId = `test-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    storeName = 'Test Store',
    companyId = 'test-company-id',
    timezone = 'America/New_York',
    setup,
    ...dbOptions
  } = options;

  // Create database with all migrations
  const dbContext: TestDatabaseContext = await createTestDatabase({
    storeId,
    storeName,
    companyId,
    timezone,
    ...dbOptions,
  });

  // Create bound seeders
  const seeders: BoundSeeders = {
    user: (opts) => seedUser(dbContext.db, storeId, opts),
    users: (count, opts) => seedUsers(dbContext.db, storeId, count, opts),
    shift: (opts) => seedShift(dbContext.db, storeId, opts),
    daySummary: (opts) => seedDaySummary(dbContext.db, storeId, opts),
    transaction: (opts) => seedTransaction(dbContext.db, storeId, opts),
    syncQueueItem: (opts) => seedSyncQueueItem(dbContext.db, storeId, opts),
    processedFile: (opts) => seedProcessedFile(dbContext.db, storeId, opts),
    fullStoreData: () => seedFullStoreData(dbContext.db, storeId),
  };

  // Create utility functions
  const utils = {
    hashPin: hashPinForTest,
    businessDate: generateBusinessDate,
    today: () => generateBusinessDate(0),
  };

  const ctx: ServiceTestContext = {
    db: dbContext.db,
    dbPath: dbContext.dbPath,
    storeId,
    storeName,
    companyId,
    timezone,
    cleanup: dbContext.cleanup,
    seeders,
    utils,
  };

  // Run additional setup if provided
  if (setup) {
    await setup(ctx);
  }

  return ctx;
}

/**
 * Create a service test context synchronously
 *
 * @param options - Configuration options
 * @returns Service test context
 */
export function createServiceTestContextSync(
  options: Omit<ServiceTestContextOptions, 'setup'> = {}
): ServiceTestContext {
  const {
    storeId = `test-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    storeName = 'Test Store',
    companyId = 'test-company-id',
    timezone = 'America/New_York',
    ...dbOptions
  } = options;

  const dbContext = createTestDatabaseSync({
    storeId,
    storeName,
    companyId,
    timezone,
    ...dbOptions,
  });

  const seeders: BoundSeeders = {
    user: (opts) => seedUser(dbContext.db, storeId, opts),
    users: (count, opts) => seedUsers(dbContext.db, storeId, count, opts),
    shift: (opts) => seedShift(dbContext.db, storeId, opts),
    daySummary: (opts) => seedDaySummary(dbContext.db, storeId, opts),
    transaction: (opts) => seedTransaction(dbContext.db, storeId, opts),
    syncQueueItem: (opts) => seedSyncQueueItem(dbContext.db, storeId, opts),
    processedFile: (opts) => seedProcessedFile(dbContext.db, storeId, opts),
    fullStoreData: () => seedFullStoreData(dbContext.db, storeId),
  };

  const utils = {
    hashPin: hashPinForTest,
    businessDate: generateBusinessDate,
    today: () => generateBusinessDate(0),
  };

  return {
    db: dbContext.db,
    dbPath: dbContext.dbPath,
    storeId,
    storeName,
    companyId,
    timezone,
    cleanup: dbContext.cleanup,
    seeders,
    utils,
  };
}

// ============================================================================
// Multi-Store Context (for tenant isolation tests)
// ============================================================================

/**
 * Multi-store test context for tenant isolation tests
 */
export interface MultiStoreTestContext {
  /** Primary store context */
  store1: ServiceTestContext;
  /** Secondary store context (same database) */
  store2: ServiceTestContext;
  /** Cleanup function - call in afterEach */
  cleanup: () => void;
}

/**
 * Create a multi-store test context for tenant isolation tests
 *
 * Both stores share the same database but have different store IDs.
 * Useful for testing DB-006 tenant isolation compliance.
 *
 * @returns Multi-store test context
 *
 * @example
 * ```typescript
 * describe('Tenant Isolation (DB-006)', () => {
 *   let ctx: MultiStoreTestContext;
 *
 *   beforeEach(async () => {
 *     ctx = await createMultiStoreTestContext();
 *   });
 *
 *   afterEach(() => ctx.cleanup());
 *
 *   it('should not leak data between stores', () => {
 *     ctx.store1.seeders.user({ name: 'Store1 User' });
 *     ctx.store2.seeders.user({ name: 'Store2 User' });
 *
 *     // Query from store1 should only see store1 data
 *   });
 * });
 * ```
 */
export async function createMultiStoreTestContext(): Promise<MultiStoreTestContext> {
  const storeId1 = `test-store-1-${Date.now()}`;
  const storeId2 = `test-store-2-${Date.now()}`;

  // Create primary store (this creates the database)
  const store1 = await createServiceTestContext({
    storeId: storeId1,
    storeName: 'Test Store 1',
    companyId: 'test-company-1',
  });

  // Add second store to the same database
  const insertStore2Stmt = store1.db.prepare(`
    INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
  `);
  insertStore2Stmt.run(storeId2, 'test-company-2', 'Test Store 2', 'America/Los_Angeles');

  // Create bound seeders for store2
  const store2Seeders: BoundSeeders = {
    user: (opts) => seedUser(store1.db, storeId2, opts),
    users: (count, opts) => seedUsers(store1.db, storeId2, count, opts),
    shift: (opts) => seedShift(store1.db, storeId2, opts),
    daySummary: (opts) => seedDaySummary(store1.db, storeId2, opts),
    transaction: (opts) => seedTransaction(store1.db, storeId2, opts),
    syncQueueItem: (opts) => seedSyncQueueItem(store1.db, storeId2, opts),
    processedFile: (opts) => seedProcessedFile(store1.db, storeId2, opts),
    fullStoreData: () => seedFullStoreData(store1.db, storeId2),
  };

  const store2: ServiceTestContext = {
    db: store1.db,
    dbPath: store1.dbPath,
    storeId: storeId2,
    storeName: 'Test Store 2',
    companyId: 'test-company-2',
    timezone: 'America/Los_Angeles',
    cleanup: () => {}, // No-op - store1 handles cleanup
    seeders: store2Seeders,
    utils: store1.utils,
  };

  return {
    store1,
    store2,
    cleanup: store1.cleanup,
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that the test context is properly initialized
 *
 * @param ctx - Service test context
 * @returns Validation result
 */
export function validateTestContext(ctx: ServiceTestContext): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check database is open
  if (!ctx.db.open) {
    issues.push('Database is not open');
  }

  // Check schema
  const schema = verifyDatabaseSchema(ctx.db);
  if (!schema.valid) {
    issues.push(`Missing tables: ${schema.missingTables.join(', ')}`);
  }

  // Check store exists
  const storeStmt = ctx.db.prepare('SELECT 1 FROM stores WHERE store_id = ?');
  if (!storeStmt.get(ctx.storeId)) {
    issues.push(`Store ${ctx.storeId} not found in database`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export {
  // Types
  type TestDatabaseContext,
  type TestDatabaseOptions,
  type SeededUser,
  type SeededShift,
  type SeededDaySummary,
  type SeededTransaction,
  type SeededSyncQueueItem,
  type SeededProcessedFile,
  type SeedUserOptions,
  type SeedShiftOptions,
  type SeedDaySummaryOptions,
  type SeedTransactionOptions,
  type SeedSyncQueueOptions,
  type SeedProcessedFileOptions,
  // Functions
  createTestDatabase,
  createTestDatabaseSync,
  verifyDatabaseSchema,
  seedUser,
  seedUsers,
  seedShift,
  seedDaySummary,
  seedTransaction,
  seedSyncQueueItem,
  seedProcessedFile,
  seedFullStoreData,
  hashPinForTest,
  generateBusinessDate,
};
