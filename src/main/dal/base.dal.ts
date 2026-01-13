/**
 * Base Data Access Layer
 *
 * Abstract base class providing common CRUD operations with enterprise-grade
 * security patterns. All queries use parameterized statements to prevent
 * SQL injection.
 *
 * @module main/dal/base
 * @security SEC-006: All queries use prepared statements with parameter binding
 * @security DB-006: Tenant isolation via store_id scoping
 * @security DB-001: ORM-like patterns with safe query building
 */

import { getDatabase, isDatabaseInitialized, type DatabaseInstance } from '../services/database.service';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Pagination options for list queries
 */
export interface PaginationOptions {
  /** Number of records per page (max 1000) */
  limit: number;
  /** Number of records to skip */
  offset: number;
}

/**
 * Sort options for list queries
 */
export interface SortOptions {
  /** Column to sort by (must be in allowlist) */
  column: string;
  /** Sort direction */
  direction: 'ASC' | 'DESC';
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Base entity with common fields
 */
export interface BaseEntity {
  created_at: string;
  updated_at?: string;
}

/**
 * Store-scoped entity
 * DB-006: All business entities must include store_id
 */
export interface StoreEntity extends BaseEntity {
  store_id: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum allowed limit for pagination to prevent unbounded reads */
const MAX_PAGE_SIZE = 1000;

/** Default page size */
const DEFAULT_PAGE_SIZE = 100;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('dal');

// ============================================================================
// Base DAL Class
// ============================================================================

/**
 * Abstract base class for Data Access Layer implementations
 *
 * Provides secure, parameterized CRUD operations with:
 * - SEC-006: All SQL uses prepared statements
 * - DB-006: Store-scoped queries for tenant isolation
 * - DB-001: ORM-like patterns preventing raw SQL injection
 *
 * @template T - Entity type
 */
export abstract class BaseDAL<T extends BaseEntity> {
  /** Table name (must match schema exactly) */
  protected abstract readonly tableName: string;

  /** Primary key column name */
  protected abstract readonly primaryKey: string;

  /**
   * Allowed columns for sorting (allowlist for SQL injection prevention)
   * Subclasses should override to add entity-specific columns
   */
  protected readonly sortableColumns: Set<string> = new Set(['created_at', 'updated_at']);

  /**
   * Get database instance
   * SEC-006: Returns instance configured for prepared statements
   * @throws Error if database is not initialized
   */
  protected get db(): DatabaseInstance {
    if (!isDatabaseInitialized()) {
      throw new Error(
        `Database not initialized. Cannot perform ${this.tableName} operations. ` +
        'Ensure bootstrapDatabase() completes before accessing DAL.'
      );
    }
    return getDatabase();
  }

  /**
   * Check if database is available for operations
   * Use this to conditionally execute database operations
   */
  protected get isDatabaseAvailable(): boolean {
    return isDatabaseInitialized();
  }

  /**
   * Generate a new UUID v4 primary key
   */
  protected generateId(): string {
    return randomUUID();
  }

  /**
   * Get current ISO timestamp
   */
  protected now(): string {
    return new Date().toISOString();
  }

  // ==========================================================================
  // Read Operations (SEC-006: Parameterized queries)
  // ==========================================================================

  /**
   * Find entity by primary key
   *
   * @param id - Primary key value
   * @returns Entity or undefined if not found
   */
  findById(id: string): T | undefined {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ?`);

    const result = stmt.get(id) as T | undefined;

    log.debug('findById executed', {
      table: this.tableName,
      found: result !== undefined,
    });

    return result;
  }

  /**
   * Find all entities (use with caution on large tables)
   * Consider using findPaginated for large datasets
   *
   * @returns Array of all entities
   */
  findAll(): T[] {
    // SEC-006: Static query with no user input
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName}`);
    return stmt.all() as T[];
  }

  /**
   * Find entities with pagination
   * SEC-006: Parameterized limit/offset
   *
   * @param options - Pagination options
   * @param sort - Optional sort options
   * @returns Paginated result with total count
   */
  findPaginated(options: Partial<PaginationOptions> = {}, sort?: SortOptions): PaginatedResult<T> {
    const limit = Math.min(options.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = options.offset || 0;

    // Build ORDER BY clause safely
    const orderBy = this.buildOrderByClause(sort);

    // Get total count
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const countResult = countStmt.get() as { count: number };
    const total = countResult.count;

    // Get paginated data
    // SEC-006: Parameterized limit/offset
    const dataStmt = this.db.prepare(`SELECT * FROM ${this.tableName} ${orderBy} LIMIT ? OFFSET ?`);
    const data = dataStmt.all(limit, offset) as T[];

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Count all entities in table
   *
   * @returns Total count
   */
  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Check if entity exists by ID
   *
   * @param id - Primary key to check
   * @returns true if entity exists
   */
  exists(id: string): boolean {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`SELECT 1 FROM ${this.tableName} WHERE ${this.primaryKey} = ?`);
    return stmt.get(id) !== undefined;
  }

  // ==========================================================================
  // Delete Operations (SEC-006: Parameterized queries)
  // ==========================================================================

  /**
   * Delete entity by primary key
   *
   * @param id - Primary key of entity to delete
   * @returns true if entity was deleted
   */
  delete(id: string): boolean {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ?`);
    const result = stmt.run(id);

    const deleted = result.changes > 0;
    log.debug('delete executed', {
      table: this.tableName,
      id,
      deleted,
    });

    return deleted;
  }

  /**
   * Delete multiple entities by IDs
   *
   * @param ids - Array of primary keys to delete
   * @returns Number of entities deleted
   */
  deleteMany(ids: string[]): number {
    if (ids.length === 0) return 0;

    // SEC-006: Parameterized IN clause using placeholders
    const placeholders = ids.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} IN (${placeholders})`
    );
    const result = stmt.run(...ids);

    log.debug('deleteMany executed', {
      table: this.tableName,
      requested: ids.length,
      deleted: result.changes,
    });

    return result.changes;
  }

  // ==========================================================================
  // Query Building Helpers (SEC-006: Safe query construction)
  // ==========================================================================

  /**
   * Build safe ORDER BY clause
   * SEC-006: Validates column against allowlist to prevent injection
   *
   * @param sort - Sort options
   * @returns SQL ORDER BY clause or empty string
   */
  protected buildOrderByClause(sort?: SortOptions): string {
    if (!sort) {
      return 'ORDER BY created_at DESC';
    }

    // SEC-006: Validate column is in allowlist
    if (!this.sortableColumns.has(sort.column)) {
      log.warn('Invalid sort column requested, using default', {
        requested: sort.column,
        allowed: Array.from(this.sortableColumns),
      });
      return 'ORDER BY created_at DESC';
    }

    // Direction is constrained by type, but double-check
    const direction = sort.direction === 'ASC' ? 'ASC' : 'DESC';

    return `ORDER BY ${sort.column} ${direction}`;
  }

  /**
   * Build parameterized WHERE clause from conditions
   * SEC-006: All values passed as parameters, never interpolated
   *
   * @param conditions - Object with column-value pairs
   * @returns Object with clause and parameters
   */
  protected buildWhereClause(conditions: Record<string, unknown>): {
    clause: string;
    params: unknown[];
  } {
    const entries = Object.entries(conditions).filter(([_, value]) => value !== undefined);

    if (entries.length === 0) {
      return { clause: '', params: [] };
    }

    const clauses: string[] = [];
    const params: unknown[] = [];

    for (const [column, value] of entries) {
      // SEC-006: Column names should be validated against schema
      // In practice, this method should only be called with known columns
      if (value === null) {
        clauses.push(`${column} IS NULL`);
      } else {
        clauses.push(`${column} = ?`);
        params.push(value);
      }
    }

    return {
      clause: `WHERE ${clauses.join(' AND ')}`,
      params,
    };
  }

  // ==========================================================================
  // Transaction Helpers
  // ==========================================================================

  /**
   * Execute function within a database transaction
   * Automatically commits on success, rolls back on error
   *
   * @param fn - Function to execute within transaction
   * @returns Result of the function
   */
  protected withTransaction<R>(fn: () => R): R {
    return this.db.transaction(fn)();
  }
}

// ============================================================================
// Store-Scoped Base DAL
// ============================================================================

/**
 * Base DAL for store-scoped entities
 * DB-006: Enforces tenant isolation via store_id on all queries
 *
 * @template T - Entity type extending StoreEntity
 */
export abstract class StoreBasedDAL<T extends StoreEntity> extends BaseDAL<T> {
  /**
   * Find entities by store ID with pagination
   * DB-006: Primary method for store-scoped data access
   *
   * @param storeId - Store identifier for tenant isolation
   * @param options - Pagination options
   * @param sort - Optional sort options
   * @returns Paginated result scoped to store
   */
  findByStore(
    storeId: string,
    options: Partial<PaginationOptions> = {},
    sort?: SortOptions
  ): PaginatedResult<T> {
    const limit = Math.min(options.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = options.offset || 0;

    const orderBy = this.buildOrderByClause(sort);

    // Count for this store
    // SEC-006: Parameterized store_id
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE store_id = ?`
    );
    const countResult = countStmt.get(storeId) as { count: number };
    const total = countResult.count;

    // Get paginated data for store
    // SEC-006: Parameterized query
    const dataStmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE store_id = ? ${orderBy} LIMIT ? OFFSET ?`
    );
    const data = dataStmt.all(storeId, limit, offset) as T[];

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Find entity by ID with store validation
   * DB-006: Ensures entity belongs to specified store
   *
   * @param storeId - Store identifier
   * @param id - Entity primary key
   * @returns Entity or undefined
   */
  findByIdForStore(storeId: string, id: string): T | undefined {
    // SEC-006: Parameterized query with store validation
    const stmt = this.db.prepare(
      `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ? AND store_id = ?`
    );
    return stmt.get(id, storeId) as T | undefined;
  }

  /**
   * Count entities for a specific store
   * DB-006: Store-scoped count
   *
   * @param storeId - Store identifier
   * @returns Count of entities for store
   */
  countByStore(storeId: string): number {
    const stmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE store_id = ?`
    );
    const result = stmt.get(storeId) as { count: number };
    return result.count;
  }

  /**
   * Delete entity with store validation
   * DB-006: Ensures entity belongs to store before deletion
   *
   * @param storeId - Store identifier
   * @param id - Entity primary key
   * @returns true if entity was deleted
   */
  deleteForStore(storeId: string, id: string): boolean {
    // SEC-006: Parameterized query with store validation
    const stmt = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ? AND store_id = ?`
    );
    const result = stmt.run(id, storeId);
    return result.changes > 0;
  }
}
