/**
 * Stores Data Access Layer
 *
 * CRUD operations for store configuration.
 * Single-store application model: typically one store per database.
 *
 * @module main/dal/stores
 * @security SEC-006: All queries use prepared statements
 */

import { BaseDAL, type BaseEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Store entity
 */
export interface Store extends BaseEntity {
  store_id: string;
  company_id: string;
  name: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
  state_id: string | null;
  state_code: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Store creation data
 */
export interface CreateStoreData {
  store_id: string;
  company_id: string;
  name: string;
  timezone?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  state_id?: string;
  state_code?: string;
}

/**
 * Store update data
 */
export interface UpdateStoreData {
  name?: string;
  timezone?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  state_id?: string;
  state_code?: string;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('stores-dal');

// ============================================================================
// Stores DAL
// ============================================================================

/**
 * Data Access Layer for store configuration
 *
 * Note: This is typically a single-row table as each Nuvana
 * installation is configured for one store.
 */
export class StoresDAL extends BaseDAL<Store> {
  protected readonly tableName = 'stores';
  protected readonly primaryKey = 'store_id';

  protected readonly sortableColumns = new Set(['created_at', 'updated_at', 'name', 'status']);

  /**
   * Create a new store
   * SEC-006: Parameterized INSERT
   *
   * @param data - Store creation data
   * @returns Created store
   */
  create(data: CreateStoreData): Store {
    const now = this.now();

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      INSERT INTO stores (
        store_id, company_id, name, timezone, status, state_id, state_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.store_id,
      data.company_id,
      data.name,
      data.timezone || 'America/New_York',
      data.status || 'ACTIVE',
      data.state_id || null,
      data.state_code || null,
      now,
      now
    );

    log.info('Store created', {
      storeId: data.store_id,
      name: data.name,
      stateCode: data.state_code,
    });

    const created = this.findById(data.store_id);
    if (!created) {
      throw new Error(`Failed to retrieve created store: ${data.store_id}`);
    }
    return created;
  }

  /**
   * Update an existing store
   * SEC-006: Parameterized UPDATE
   *
   * @param storeId - Store ID to update
   * @param data - Fields to update
   * @returns Updated store or undefined if not found
   */
  update(storeId: string, data: UpdateStoreData): Store | undefined {
    const now = this.now();

    // Build dynamic UPDATE clause
    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.timezone !== undefined) {
      updates.push('timezone = ?');
      params.push(data.timezone);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }
    if (data.state_id !== undefined) {
      updates.push('state_id = ?');
      params.push(data.state_id);
    }
    if (data.state_code !== undefined) {
      updates.push('state_code = ?');
      params.push(data.state_code);
    }

    // Add store_id to params
    params.push(storeId);

    // SEC-006: Parameterized UPDATE
    const stmt = this.db.prepare(`
      UPDATE stores SET ${updates.join(', ')} WHERE store_id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      log.warn('Store not found for update', { storeId });
      return undefined;
    }

    log.info('Store updated', { storeId });
    return this.findById(storeId);
  }

  /**
   * Get the configured store (single-store model)
   * Returns the first (and typically only) store
   *
   * @returns Configured store or undefined (also undefined if db not ready)
   */
  getConfiguredStore(): Store | undefined {
    if (!this.isDatabaseAvailable) {
      return undefined;
    }
    // SEC-006: Static query
    const stmt = this.db.prepare(`
      SELECT * FROM stores WHERE status = 'ACTIVE' LIMIT 1
    `);
    return stmt.get() as Store | undefined;
  }

  /**
   * Check if any store is configured
   *
   * @returns true if at least one store exists, false if db not ready or no stores
   */
  isConfigured(): boolean {
    if (!this.isDatabaseAvailable) {
      return false;
    }
    const stmt = this.db.prepare(`SELECT 1 FROM stores LIMIT 1`);
    return stmt.get() !== undefined;
  }

  /**
   * Check if database is ready for store operations
   */
  isDatabaseReady(): boolean {
    return this.isDatabaseAvailable;
  }

  /**
   * Find store by company ID
   * SEC-006: Parameterized query
   *
   * @param companyId - Company identifier
   * @returns Store or undefined
   */
  findByCompanyId(companyId: string): Store | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM stores WHERE company_id = ?
    `);
    return stmt.get(companyId) as Store | undefined;
  }

  /**
   * Upsert store from cloud sync
   * Creates if not exists, updates if exists
   * SEC-006: Parameterized query
   *
   * @param data - Store data from cloud
   * @returns Upserted store
   */
  upsertFromCloud(data: CreateStoreData): Store {
    const existing = this.findById(data.store_id);

    if (existing) {
      const updated = this.update(data.store_id, {
        name: data.name,
        timezone: data.timezone,
        status: data.status,
      });
      if (!updated) {
        throw new Error(`Failed to update store from cloud: ${data.store_id}`);
      }
      return updated;
    }

    return this.create(data);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for store operations
 */
export const storesDAL = new StoresDAL();
