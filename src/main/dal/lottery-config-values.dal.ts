/**
 * Lottery Configuration Values Data Access Layer
 *
 * Manages lottery configuration values (ticket prices, pack values).
 * These values are synced from cloud and cached locally.
 *
 * @module main/dal/lottery-config-values
 * @security SEC-006: All queries use prepared statements
 * @security DB-001: ORM-like patterns with safe query building
 */

import { BaseDAL, type BaseEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration type enum
 */
export type LotteryConfigType = 'TICKET_PRICE' | 'PACK_VALUE';

/**
 * Lottery config value entity
 */
export interface LotteryConfigValue extends BaseEntity {
  config_value_id: string;
  config_type: LotteryConfigType;
  amount: number;
  display_order: number;
  is_active: number; // SQLite uses 0/1 for boolean
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Config value creation data
 */
export interface CreateLotteryConfigValueData {
  config_value_id: string;
  config_type: LotteryConfigType;
  amount: number;
  display_order?: number;
  is_active?: boolean;
}

/**
 * Config values response for API
 */
export interface LotteryConfigValuesResponse {
  ticket_prices: Array<{
    config_value_id: string;
    amount: number;
    display_order: number;
  }>;
  pack_values: Array<{
    config_value_id: string;
    amount: number;
    display_order: number;
  }>;
}

/**
 * Cloud config value data for sync
 */
export interface CloudConfigValueData {
  config_value_id: string;
  config_type: LotteryConfigType;
  amount: number;
  display_order: number;
  is_active: boolean;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('lottery-config-values-dal');

// ============================================================================
// Lottery Config Values DAL
// ============================================================================

/**
 * Data Access Layer for lottery configuration values
 *
 * SEC-006: All queries use prepared statements
 * DB-001: ORM-like patterns with safe query building
 */
export class LotteryConfigValuesDAL extends BaseDAL<LotteryConfigValue> {
  protected readonly tableName = 'lottery_config_values';
  protected readonly primaryKey = 'config_value_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'config_type',
    'amount',
    'display_order',
  ]);

  /**
   * Get all active config values grouped by type
   * SEC-006: Parameterized query
   *
   * @returns Config values grouped by type
   */
  getActiveConfigValues(): LotteryConfigValuesResponse {
    // SEC-006: Static query with no user input
    const stmt = this.db.prepare(`
      SELECT config_value_id, config_type, amount, display_order
      FROM lottery_config_values
      WHERE is_active = 1
      ORDER BY config_type ASC, display_order ASC
    `);

    const rows = stmt.all() as Array<{
      config_value_id: string;
      config_type: LotteryConfigType;
      amount: number;
      display_order: number;
    }>;

    // Group by type
    const ticketPrices = rows
      .filter((r) => r.config_type === 'TICKET_PRICE')
      .map((r) => ({
        config_value_id: r.config_value_id,
        amount: r.amount,
        display_order: r.display_order,
      }));

    const packValues = rows
      .filter((r) => r.config_type === 'PACK_VALUE')
      .map((r) => ({
        config_value_id: r.config_value_id,
        amount: r.amount,
        display_order: r.display_order,
      }));

    return {
      ticket_prices: ticketPrices,
      pack_values: packValues,
    };
  }

  /**
   * Get config values by type
   * SEC-006: Parameterized query
   *
   * @param configType - Config type to filter by
   * @returns Array of config values
   */
  getByType(configType: LotteryConfigType): LotteryConfigValue[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_config_values
      WHERE config_type = ? AND is_active = 1
      ORDER BY display_order ASC
    `);
    return stmt.all(configType) as LotteryConfigValue[];
  }

  /**
   * Check if any config values exist
   * Used to determine if initial sync is needed
   *
   * @returns true if config values exist
   */
  hasConfigValues(): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM lottery_config_values WHERE is_active = 1 LIMIT 1
    `);
    return stmt.get() !== undefined;
  }

  /**
   * Upsert config value from cloud sync
   * Creates if not exists, updates if exists
   * SEC-006: Parameterized queries
   *
   * @param data - Cloud config value data
   * @returns Upserted config value
   */
  upsertFromCloud(data: CloudConfigValueData): LotteryConfigValue {
    const now = this.now();

    // Check if exists by ID
    const existing = this.findById(data.config_value_id);

    if (existing) {
      // Update existing
      const stmt = this.db.prepare(`
        UPDATE lottery_config_values SET
          config_type = ?,
          amount = ?,
          display_order = ?,
          is_active = ?,
          synced_at = ?,
          updated_at = ?
        WHERE config_value_id = ?
      `);

      stmt.run(
        data.config_type,
        data.amount,
        data.display_order,
        data.is_active ? 1 : 0,
        now,
        now,
        data.config_value_id
      );

      log.debug('Config value updated from cloud', { id: data.config_value_id });
    } else {
      // Insert new
      const stmt = this.db.prepare(`
        INSERT INTO lottery_config_values (
          config_value_id, config_type, amount, display_order,
          is_active, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        data.config_value_id,
        data.config_type,
        data.amount,
        data.display_order,
        data.is_active ? 1 : 0,
        now,
        now,
        now
      );

      log.debug('Config value created from cloud', { id: data.config_value_id });
    }

    const result = this.findById(data.config_value_id);
    if (!result) {
      throw new Error(`Failed to retrieve upserted config value: ${data.config_value_id}`);
    }
    return result;
  }

  /**
   * Bulk upsert config values from cloud
   * Efficient batch operation within a transaction
   * SEC-006: Parameterized queries
   *
   * @param values - Array of cloud config values
   * @returns Number of values upserted
   */
  bulkUpsertFromCloud(values: CloudConfigValueData[]): number {
    if (values.length === 0) return 0;

    return this.withTransaction(() => {
      let count = 0;
      for (const value of values) {
        this.upsertFromCloud(value);
        count++;
      }

      log.info('Bulk upserted config values from cloud', { count });
      return count;
    });
  }

  /**
   * Clear all config values
   * Used before full sync from cloud
   *
   * @returns Number of values deleted
   */
  clearAll(): number {
    const stmt = this.db.prepare('DELETE FROM lottery_config_values');
    const result = stmt.run();

    log.info('Cleared all config values', { deleted: result.changes });
    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for lottery config value operations
 */
export const lotteryConfigValuesDAL = new LotteryConfigValuesDAL();
