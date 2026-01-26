/**
 * Test Data Seeders
 *
 * Factory functions for creating test data in the database.
 * All seeders use parameterized queries for SQL injection safety.
 *
 * @module tests/helpers/test-seeders
 *
 * Security Compliance:
 * - SEC-006: All SQL via parameterized queries
 * - SEC-001: PINs stored as bcrypt hashes
 * - DB-006: All entities include store_id for tenant isolation
 *
 * Usage:
 * ```typescript
 * const ctx = await createTestDatabase();
 * const user = seedUser(ctx.db, ctx.storeId, { name: 'John Doe' });
 * const shift = seedShift(ctx.db, ctx.storeId, { shift_number: 1 });
 * ```
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/** User role options */
export type UserRole = 'store_manager' | 'shift_manager' | 'cashier';

/** Shift status options */
export type ShiftStatus = 'OPEN' | 'CLOSED';

/** POS system type options */
export type POSSystemType =
  | 'GILBARCO_PASSPORT'
  | 'GILBARCO_NAXML'
  | 'VERIFONE_RUBY2'
  | 'VERIFONE_COMMANDER'
  | 'SQUARE_REST'
  | 'CLOVER_REST'
  | 'NCR_RADIANT'
  | 'INFOR_POS'
  | 'ORACLE_SIMPHONY'
  | 'CUSTOM_API'
  | 'FILE_BASED'
  | 'MANUAL'
  | 'MANUAL_ENTRY';

/** POS connection type options */
export type POSConnectionType = 'FILE' | 'API' | 'NETWORK' | 'WEBHOOK' | 'MANUAL';

// ============================================================================
// User Seeders
// ============================================================================

/**
 * User entity returned from seeder
 */
export interface SeededUser {
  user_id: string;
  store_id: string;
  role: UserRole;
  name: string;
  pin_hash: string;
  active: number;
  last_login_at: string | null;
  cloud_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * User seeder options
 */
export interface SeedUserOptions {
  user_id?: string;
  role?: UserRole;
  name?: string;
  pin?: string;
  active?: boolean;
  cloud_user_id?: string;
}

/**
 * Seed a user into the database
 *
 * @param db - Database instance
 * @param storeId - Store ID for tenant isolation
 * @param options - User configuration overrides
 * @returns Seeded user record
 *
 * @example
 * ```typescript
 * const user = seedUser(db, storeId, { name: 'Alice', role: 'shift_manager' });
 * ```
 */
export function seedUser(
  db: Database.Database,
  storeId: string,
  options: SeedUserOptions = {}
): SeededUser {
  const userId = options.user_id ?? randomUUID();
  const now = new Date().toISOString();
  const pin = options.pin ?? '1234';
  const pinHash = bcrypt.hashSync(pin, 10); // Lower rounds for test speed

  // SEC-006: Parameterized query
  const stmt = db.prepare(`
    INSERT INTO users (
      user_id, store_id, role, name, pin_hash, active,
      cloud_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    userId,
    storeId,
    options.role ?? 'cashier',
    options.name ?? `Test User ${userId.slice(0, 8)}`,
    pinHash,
    options.active === false ? 0 : 1,
    options.cloud_user_id ?? null,
    now,
    now
  );

  return {
    user_id: userId,
    store_id: storeId,
    role: options.role ?? 'cashier',
    name: options.name ?? `Test User ${userId.slice(0, 8)}`,
    pin_hash: pinHash,
    active: options.active === false ? 0 : 1,
    last_login_at: null,
    cloud_user_id: options.cloud_user_id ?? null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Seed multiple users at once
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @param count - Number of users to create
 * @param baseOptions - Options applied to all users
 * @returns Array of seeded users
 */
export function seedUsers(
  db: Database.Database,
  storeId: string,
  count: number,
  baseOptions: Omit<SeedUserOptions, 'user_id'> = {}
): SeededUser[] {
  const users: SeededUser[] = [];
  for (let i = 0; i < count; i++) {
    users.push(
      seedUser(db, storeId, {
        ...baseOptions,
        name: baseOptions.name ?? `Test User ${i + 1}`,
      })
    );
  }
  return users;
}

// ============================================================================
// Shift Seeders
// ============================================================================

/**
 * Shift entity returned from seeder
 */
export interface SeededShift {
  shift_id: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id: string | null;
  register_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: ShiftStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Shift seeder options
 */
export interface SeedShiftOptions {
  shift_id?: string;
  shift_number?: number;
  business_date?: string;
  cashier_id?: string;
  register_id?: string;
  start_time?: string;
  end_time?: string;
  status?: ShiftStatus;
}

/**
 * Seed a shift into the database
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @param options - Shift configuration overrides
 * @returns Seeded shift record
 */
export function seedShift(
  db: Database.Database,
  storeId: string,
  options: SeedShiftOptions = {}
): SeededShift {
  const shiftId = options.shift_id ?? randomUUID();
  const now = new Date().toISOString();
  const businessDate = options.business_date ?? new Date().toISOString().split('T')[0];

  // SEC-006: Parameterized query
  const stmt = db.prepare(`
    INSERT INTO shifts (
      shift_id, store_id, shift_number, business_date,
      cashier_id, register_id, start_time, end_time, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    shiftId,
    storeId,
    options.shift_number ?? 1,
    businessDate,
    options.cashier_id ?? null,
    options.register_id ?? null,
    options.start_time ?? now,
    options.end_time ?? null,
    options.status ?? 'OPEN',
    now,
    now
  );

  return {
    shift_id: shiftId,
    store_id: storeId,
    shift_number: options.shift_number ?? 1,
    business_date: businessDate,
    cashier_id: options.cashier_id ?? null,
    register_id: options.register_id ?? null,
    start_time: options.start_time ?? now,
    end_time: options.end_time ?? null,
    status: options.status ?? 'OPEN',
    created_at: now,
    updated_at: now,
  };
}

// ============================================================================
// Day Summary Seeders
// ============================================================================

/**
 * Day summary entity returned from seeder
 */
export interface SeededDaySummary {
  summary_id: string;
  store_id: string;
  business_date: string;
  total_sales: number;
  total_transactions: number;
  status: 'OPEN' | 'CLOSED';
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Day summary seeder options
 */
export interface SeedDaySummaryOptions {
  summary_id?: string;
  business_date?: string;
  total_sales?: number;
  total_transactions?: number;
  status?: 'OPEN' | 'CLOSED';
  closed_at?: string;
}

/**
 * Seed a day summary into the database
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @param options - Day summary configuration overrides
 * @returns Seeded day summary record
 */
export function seedDaySummary(
  db: Database.Database,
  storeId: string,
  options: SeedDaySummaryOptions = {}
): SeededDaySummary {
  const summaryId = options.summary_id ?? randomUUID();
  const now = new Date().toISOString();
  const businessDate = options.business_date ?? new Date().toISOString().split('T')[0];

  // SEC-006: Parameterized query
  const stmt = db.prepare(`
    INSERT INTO day_summaries (
      summary_id, store_id, business_date, total_sales,
      total_transactions, status, closed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    summaryId,
    storeId,
    businessDate,
    options.total_sales ?? 0,
    options.total_transactions ?? 0,
    options.status ?? 'OPEN',
    options.closed_at ?? null,
    now,
    now
  );

  return {
    summary_id: summaryId,
    store_id: storeId,
    business_date: businessDate,
    total_sales: options.total_sales ?? 0,
    total_transactions: options.total_transactions ?? 0,
    status: options.status ?? 'OPEN',
    closed_at: options.closed_at ?? null,
    created_at: now,
    updated_at: now,
  };
}

// ============================================================================
// Transaction Seeders
// ============================================================================

/**
 * Transaction entity returned from seeder
 */
export interface SeededTransaction {
  transaction_id: string;
  store_id: string;
  shift_id: string | null;
  business_date: string;
  transaction_number: number | null;
  transaction_time: string | null;
  register_id: string | null;
  cashier_id: string | null;
  total_amount: number;
  payment_type: string | null;
  voided: number;
  void_reason: string | null;
  created_at: string;
}

/**
 * Transaction seeder options
 */
export interface SeedTransactionOptions {
  transaction_id?: string;
  shift_id?: string;
  business_date?: string;
  transaction_number?: number;
  transaction_time?: string;
  register_id?: string;
  cashier_id?: string;
  total_amount?: number;
  payment_type?: string;
  voided?: boolean;
  void_reason?: string;
}

/**
 * Seed a transaction into the database
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @param options - Transaction configuration overrides
 * @returns Seeded transaction record
 */
export function seedTransaction(
  db: Database.Database,
  storeId: string,
  options: SeedTransactionOptions = {}
): SeededTransaction {
  const transactionId = options.transaction_id ?? randomUUID();
  const now = new Date().toISOString();
  const businessDate = options.business_date ?? new Date().toISOString().split('T')[0];

  // SEC-006: Parameterized query
  const stmt = db.prepare(`
    INSERT INTO transactions (
      transaction_id, store_id, shift_id, business_date,
      transaction_number, transaction_time, register_id, cashier_id,
      total_amount, payment_type, voided, void_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    transactionId,
    storeId,
    options.shift_id ?? null,
    businessDate,
    options.transaction_number ?? null,
    options.transaction_time ?? now,
    options.register_id ?? null,
    options.cashier_id ?? null,
    options.total_amount ?? 0,
    options.payment_type ?? null,
    options.voided ? 1 : 0,
    options.void_reason ?? null,
    now
  );

  return {
    transaction_id: transactionId,
    store_id: storeId,
    shift_id: options.shift_id ?? null,
    business_date: businessDate,
    transaction_number: options.transaction_number ?? null,
    transaction_time: options.transaction_time ?? now,
    register_id: options.register_id ?? null,
    cashier_id: options.cashier_id ?? null,
    total_amount: options.total_amount ?? 0,
    payment_type: options.payment_type ?? null,
    voided: options.voided ? 1 : 0,
    void_reason: options.void_reason ?? null,
    created_at: now,
  };
}

// ============================================================================
// Sync Queue Seeders
// ============================================================================

/**
 * Sync queue entity returned from seeder
 */
export interface SeededSyncQueueItem {
  sync_id: string;
  store_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  status: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Sync queue seeder options
 */
export interface SeedSyncQueueOptions {
  sync_id?: string;
  entity_type?: string;
  entity_id?: string;
  operation?: string;
  payload?: Record<string, unknown>;
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  attempt_count?: number;
}

/**
 * Seed a sync queue item into the database
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @param options - Sync queue configuration overrides
 * @returns Seeded sync queue record
 */
export function seedSyncQueueItem(
  db: Database.Database,
  storeId: string,
  options: SeedSyncQueueOptions = {}
): SeededSyncQueueItem {
  const syncId = options.sync_id ?? randomUUID();
  const now = new Date().toISOString();
  const payload = JSON.stringify(options.payload ?? {});

  // SEC-006: Parameterized query
  const stmt = db.prepare(`
    INSERT INTO sync_queue (
      sync_id, store_id, entity_type, entity_id, operation,
      payload, status, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    syncId,
    storeId,
    options.entity_type ?? 'test_entity',
    options.entity_id ?? randomUUID(),
    options.operation ?? 'CREATE',
    payload,
    options.status ?? 'PENDING',
    options.attempt_count ?? 0,
    now,
    now
  );

  return {
    sync_id: syncId,
    store_id: storeId,
    entity_type: options.entity_type ?? 'test_entity',
    entity_id: options.entity_id ?? randomUUID(),
    operation: options.operation ?? 'CREATE',
    payload,
    status: options.status ?? 'PENDING',
    attempt_count: options.attempt_count ?? 0,
    created_at: now,
    updated_at: now,
  };
}

// ============================================================================
// Processed Files Seeders
// ============================================================================

/**
 * Processed file entity returned from seeder
 */
export interface SeededProcessedFile {
  file_id: string;
  store_id: string;
  file_path: string;
  file_hash: string;
  file_size: number;
  processed_at: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

/**
 * Processed file seeder options
 */
export interface SeedProcessedFileOptions {
  file_id?: string;
  file_path?: string;
  file_hash?: string;
  file_size?: number;
  processed_at?: string;
  status?: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error_message?: string;
}

/**
 * Seed a processed file record into the database
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @param options - Processed file configuration overrides
 * @returns Seeded processed file record
 */
export function seedProcessedFile(
  db: Database.Database,
  storeId: string,
  options: SeedProcessedFileOptions = {}
): SeededProcessedFile {
  const fileId = options.file_id ?? randomUUID();
  const now = new Date().toISOString();

  // SEC-006: Parameterized query
  const stmt = db.prepare(`
    INSERT INTO processed_files (
      file_id, store_id, file_path, file_hash, file_size,
      processed_at, status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    fileId,
    storeId,
    options.file_path ?? `/test/path/${fileId}.xml`,
    options.file_hash ?? randomUUID().replace(/-/g, ''),
    options.file_size ?? 1024,
    options.processed_at ?? now,
    options.status ?? 'SUCCESS',
    options.error_message ?? null,
    now
  );

  return {
    file_id: fileId,
    store_id: storeId,
    file_path: options.file_path ?? `/test/path/${fileId}.xml`,
    file_hash: options.file_hash ?? randomUUID().replace(/-/g, ''),
    file_size: options.file_size ?? 1024,
    processed_at: options.processed_at ?? now,
    status: options.status ?? 'SUCCESS',
    error_message: options.error_message ?? null,
    created_at: now,
  };
}

// ============================================================================
// Composite Seeders
// ============================================================================

/**
 * Seed complete test data for a typical store scenario
 *
 * @param db - Database instance
 * @param storeId - Store ID
 * @returns Object containing all seeded data
 */
export function seedFullStoreData(
  db: Database.Database,
  storeId: string
): {
  manager: SeededUser;
  shiftManager: SeededUser;
  cashiers: SeededUser[];
  shift: SeededShift;
  daySummary: SeededDaySummary;
  transactions: SeededTransaction[];
} {
  // Create users
  const manager = seedUser(db, storeId, {
    role: 'store_manager',
    name: 'Store Manager',
    pin: '0000',
  });

  const shiftManager = seedUser(db, storeId, {
    role: 'shift_manager',
    name: 'Shift Manager',
    pin: '1111',
  });

  const cashiers = seedUsers(db, storeId, 3, {
    role: 'cashier',
    pin: '2222',
  });

  // Create business day data
  const today = new Date().toISOString().split('T')[0];

  const shift = seedShift(db, storeId, {
    shift_number: 1,
    business_date: today,
    cashier_id: cashiers[0].user_id,
    status: 'OPEN',
  });

  const daySummary = seedDaySummary(db, storeId, {
    business_date: today,
    status: 'OPEN',
  });

  // Create transactions
  const transactions = [
    seedTransaction(db, storeId, {
      shift_id: shift.shift_id,
      business_date: today,
      transaction_number: 1,
      total_amount: 25.99,
      payment_type: 'CASH',
    }),
    seedTransaction(db, storeId, {
      shift_id: shift.shift_id,
      business_date: today,
      transaction_number: 2,
      total_amount: 42.5,
      payment_type: 'CREDIT',
    }),
    seedTransaction(db, storeId, {
      shift_id: shift.shift_id,
      business_date: today,
      transaction_number: 3,
      total_amount: 15.0,
      payment_type: 'DEBIT',
    }),
  ];

  return {
    manager,
    shiftManager,
    cashiers,
    shift,
    daySummary,
    transactions,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Hash a PIN for testing (lower rounds for speed)
 *
 * @param pin - Plaintext PIN
 * @returns Bcrypt hash
 */
export function hashPinForTest(pin: string): string {
  return bcrypt.hashSync(pin, 10);
}

/**
 * Verify a PIN against a hash
 *
 * @param pin - Plaintext PIN
 * @param hash - Bcrypt hash
 * @returns true if PIN matches
 */
export function verifyPin(pin: string, hash: string): boolean {
  return bcrypt.compareSync(pin, hash);
}

/**
 * Generate a test business date (YYYY-MM-DD format)
 *
 * @param daysOffset - Days from today (negative for past)
 * @returns Business date string
 */
export function generateBusinessDate(daysOffset: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split('T')[0];
}
