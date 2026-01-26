/**
 * Test Helpers Index
 *
 * Central export point for all test infrastructure utilities.
 *
 * @module tests/helpers
 *
 * Usage:
 * ```typescript
 * import {
 *   createServiceTestContext,
 *   createTestDatabase,
 *   seedUser,
 * } from '../helpers';
 * ```
 */

// Test Database Factory
export {
  createTestDatabase,
  createTestDatabaseSync,
  clearMigrationCache,
  getMigrationCount,
  verifyDatabaseSchema,
  type TestDatabaseContext,
  type TestDatabaseOptions,
} from './test-database';

// Test Data Seeders
export {
  seedUser,
  seedUsers,
  seedShift,
  seedDaySummary,
  seedTransaction,
  seedSyncQueueItem,
  seedProcessedFile,
  seedFullStoreData,
  hashPinForTest,
  verifyPin,
  generateBusinessDate,
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
  type UserRole,
  type ShiftStatus,
  type POSSystemType,
  type POSConnectionType,
} from './test-seeders';

// Service Test Context
export {
  createServiceTestContext,
  createServiceTestContextSync,
  createMultiStoreTestContext,
  validateTestContext,
  type ServiceTestContext,
  type ServiceTestContextOptions,
  type MultiStoreTestContext,
  type BoundSeeders,
} from './test-context';
