/**
 * POS ID Mappings Data Access Layer
 *
 * Maps external POS system IDs (Gilbarco, Verifone, etc.) to internal UUIDs.
 * Provides getOrCreate pattern for automatic mapping creation during XML processing.
 *
 * @module main/dal/pos-id-mappings
 * @security SEC-006: All queries use prepared statements with parameter binding
 * @security DB-006: Store-scoped for tenant isolation - all queries include store_id
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported POS system types
 */
export type POSSystemType = 'gilbarco' | 'verifone' | 'wayne' | 'generic';

/**
 * Terminal types for register mapping
 */
export type TerminalType = 'REGISTER' | 'FUEL_DISPENSER' | 'KIOSK' | 'MOBILE';

/**
 * Fuel types for grade mapping
 */
export type FuelType = 'REGULAR' | 'MIDGRADE' | 'PREMIUM' | 'DIESEL' | 'E85' | 'DEF' | 'OTHER';

/**
 * Tender types for payment mapping
 */
export type TenderType =
  | 'CASH'
  | 'CREDIT'
  | 'DEBIT'
  | 'EBT'
  | 'CHECK'
  | 'GIFT'
  | 'FLEET'
  | 'LOYALTY'
  | 'OTHER';

/**
 * Price tier types
 */
export type PriceTierType = 'CASH' | 'CREDIT' | 'FLEET' | 'LOYALTY' | 'EMPLOYEE' | 'OTHER';

// ============================================================================
// Entity Interfaces
// ============================================================================

/**
 * Base mapping entity
 */
interface BaseMappingEntity extends StoreEntity {
  id: string;
  pos_system_type: POSSystemType;
  created_at: string;
  updated_at: string;
}

/**
 * Store ID mapping
 */
export interface POSStoreMapping extends BaseMappingEntity {
  external_store_id: string;
  description: string | null;
}

/**
 * Cashier/Employee ID mapping
 */
export interface POSCashierMapping extends BaseMappingEntity {
  internal_user_id: string | null;
  external_cashier_id: string;
  external_name: string | null;
  is_system_default: number;
  active: number;
}

/**
 * Terminal/Register ID mapping
 */
export interface POSTerminalMapping extends BaseMappingEntity {
  external_register_id: string;
  terminal_type: TerminalType;
  description: string | null;
  active: number;
}

/**
 * Fuel Position/Dispenser ID mapping
 */
export interface POSFuelPositionMapping extends BaseMappingEntity {
  external_position_id: string;
  related_terminal_mapping_id: string | null;
  pump_number: number | null;
  description: string | null;
  active: number;
}

/**
 * Till ID mapping
 */
export interface POSTillMapping extends BaseMappingEntity {
  shift_id: string | null;
  external_till_id: string;
  business_date: string | null;
  related_terminal_mapping_id: string | null;
}

/**
 * Fuel Grade ID mapping
 */
export interface POSFuelGradeMapping extends BaseMappingEntity {
  external_grade_id: string;
  internal_grade_name: string | null;
  fuel_type: FuelType | null;
  active: number;
}

/**
 * Fuel Product ID mapping
 */
export interface POSFuelProductMapping extends BaseMappingEntity {
  external_product_id: string;
  internal_product_name: string | null;
  related_grade_mapping_id: string | null;
  active: number;
}

/**
 * Department/Merchandise Code mapping
 */
export interface POSDepartmentMapping extends BaseMappingEntity {
  department_id: string | null;
  external_merch_code: string;
  external_description: string | null;
  active: number;
}

/**
 * Tax Level ID mapping
 */
export interface POSTaxLevelMapping extends BaseMappingEntity {
  external_tax_level_id: string;
  internal_tax_name: string | null;
  tax_rate: number | null;
  jurisdiction: string | null;
  active: number;
}

/**
 * Tender/Payment Method mapping
 */
export interface POSTenderMapping extends BaseMappingEntity {
  tender_id: string | null;
  external_tender_code: string;
  external_tender_subcode: string | null;
  internal_tender_type: TenderType | null;
  description: string | null;
  active: number;
}

/**
 * Price Tier mapping
 */
export interface POSPriceTierMapping extends BaseMappingEntity {
  external_tier_code: string;
  tier_name: string | null;
  tier_type: PriceTierType | null;
  price_differential: number | null;
  active: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('pos-id-mappings-dal');

// ============================================================================
// Cashier Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Cashier ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSCashierMappingsDAL extends StoreBasedDAL<POSCashierMapping> {
  protected readonly tableName = 'pos_cashier_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_cashier_id',
    'external_name',
  ]);

  /**
   * Get or create a cashier mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   *
   * @param storeId - Internal store UUID
   * @param externalCashierId - External POS cashier ID
   * @param options - Optional additional data
   * @returns Mapping with internal ID
   */
  getOrCreate(
    storeId: string,
    externalCashierId: string,
    options?: {
      externalName?: string;
      posSystemType?: POSSystemType;
      isSystemDefault?: boolean;
    }
  ): POSCashierMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalCashierId, posSystemType);
    if (existing) {
      // Update name if provided and currently null
      if (options?.externalName && !existing.external_name) {
        this.updateName(existing.id, options.externalName);
        existing.external_name = options.externalName;
      }
      return existing;
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_cashier_mappings (
        id, store_id, external_cashier_id, external_name,
        pos_system_type, is_system_default, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalCashierId,
      options?.externalName || null,
      posSystemType,
      options?.isSystemDefault ? 1 : 0,
      now,
      now
    );

    log.info('Created cashier mapping', {
      id,
      storeId,
      externalCashierId,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created cashier mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external cashier ID
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalCashierId: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSCashierMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_cashier_mappings
      WHERE store_id = ? AND external_cashier_id = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalCashierId, posSystemType) as POSCashierMapping | undefined;
  }

  /**
   * Update external name
   * SEC-006: Parameterized UPDATE
   */
  private updateName(id: string, name: string): void {
    const stmt = this.db.prepare(`
      UPDATE pos_cashier_mappings SET external_name = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(name, this.now(), id);
  }

  /**
   * Link mapping to internal user
   * SEC-006: Parameterized UPDATE
   */
  linkToUser(id: string, internalUserId: string): void {
    const stmt = this.db.prepare(`
      UPDATE pos_cashier_mappings SET internal_user_id = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(internalUserId, this.now(), id);
    log.info('Linked cashier mapping to user', { mappingId: id, userId: internalUserId });
  }
}

// ============================================================================
// Terminal Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Terminal/Register ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSTerminalMappingsDAL extends StoreBasedDAL<POSTerminalMapping> {
  protected readonly tableName = 'pos_terminal_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_register_id',
    'terminal_type',
  ]);

  /**
   * Get or create a terminal mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   *
   * @param storeId - Internal store UUID
   * @param externalRegisterId - External POS register ID
   * @param options - Optional additional data
   * @returns Mapping with internal ID
   */
  getOrCreate(
    storeId: string,
    externalRegisterId: string,
    options?: {
      terminalType?: TerminalType;
      description?: string;
      posSystemType?: POSSystemType;
    }
  ): POSTerminalMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalRegisterId, posSystemType);
    if (existing) {
      return existing;
    }

    // Determine terminal type from register ID pattern if not provided
    // Gilbarco pattern: "1" = store register, "10002-10006" = fuel dispensers
    let terminalType = options?.terminalType;
    if (!terminalType) {
      terminalType = this.inferTerminalType(externalRegisterId);
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_terminal_mappings (
        id, store_id, external_register_id, terminal_type,
        description, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalRegisterId,
      terminalType,
      options?.description || null,
      posSystemType,
      now,
      now
    );

    log.info('Created terminal mapping', {
      id,
      storeId,
      externalRegisterId,
      terminalType,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created terminal mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external register ID
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalRegisterId: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSTerminalMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_terminal_mappings
      WHERE store_id = ? AND external_register_id = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalRegisterId, posSystemType) as POSTerminalMapping | undefined;
  }

  /**
   * Update an existing terminal mapping.
   *
   * Builds a dynamic SET clause from non-undefined fields only.
   * Column names are from a compile-time fixed allowlist (TerminalType, description, active),
   * not from user input — no SQL injection risk in the SET clause.
   *
   * @security DB-006: Store-scoped via existing record lookup (callers use findByExternalId first)
   * @security SEC-006: Prepared statement with parameter binding for all values
   *
   * @param id - Internal UUID of the terminal mapping
   * @param updates - Partial update fields (only non-undefined fields are applied)
   * @returns Updated mapping, or existing mapping unchanged if no fields to update
   */
  update(
    id: string,
    updates: Partial<{
      terminal_type: TerminalType;
      description: string | null;
      active: number;
    }>
  ): POSTerminalMapping | undefined {
    // SEC-006: Build parameterized SET clause from fixed allowlist of column names
    const fields: [string, unknown][] = [];
    if (updates.terminal_type !== undefined) fields.push(['terminal_type', updates.terminal_type]);
    if (updates.description !== undefined) fields.push(['description', updates.description]);
    if (updates.active !== undefined) fields.push(['active', updates.active]);

    // No fields to update — return existing record unchanged
    if (fields.length === 0) {
      return this.findById(id);
    }

    // Always update the timestamp
    fields.push(['updated_at', this.now()]);

    // SEC-006: Column names from compile-time allowlist, values bound via ? placeholders
    const setClause = fields.map(([k]) => `${k} = ?`).join(', ');
    const params = [...fields.map(([, v]) => v), id];

    const stmt = this.db.prepare(`UPDATE pos_terminal_mappings SET ${setClause} WHERE id = ?`);
    stmt.run(...params);

    log.debug('Updated terminal mapping', {
      id,
      updatedFields: fields.map(([k]) => k),
    });

    return this.findById(id);
  }

  /**
   * Find all fuel dispenser terminals for a store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findFuelDispensers(storeId: string): POSTerminalMapping[] {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_terminal_mappings
      WHERE store_id = ? AND terminal_type = 'FUEL_DISPENSER' AND active = 1
      ORDER BY external_register_id ASC
    `);
    return stmt.all(storeId) as POSTerminalMapping[];
  }

  /**
   * Find all registers (non-fuel-dispenser terminals) for a store
   * SEC-006: Parameterized query with bound parameters
   * DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param includeInactive - Whether to include inactive registers (default: false)
   * @returns Array of register terminal mappings ordered by external_register_id
   */
  findRegisters(storeId: string, includeInactive: boolean = false): POSTerminalMapping[] {
    // SEC-006: Parameterized query - storeId bound via prepared statement
    // Performance: Uses idx_pos_terminal_map_type index (store_id, terminal_type)
    const stmt = this.db.prepare(`
      SELECT * FROM pos_terminal_mappings
      WHERE store_id = ?
        AND terminal_type = 'REGISTER'
        ${includeInactive ? '' : 'AND active = 1'}
      ORDER BY external_register_id ASC
    `);
    return stmt.all(storeId) as POSTerminalMapping[];
  }

  /**
   * Find all active terminals for a store (all types)
   * SEC-006: Parameterized query with bound parameters
   * DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Array of all active terminal mappings
   */
  findAllActive(storeId: string): POSTerminalMapping[] {
    // SEC-006: Parameterized query
    // Performance: Uses idx_pos_terminal_map_lookup index
    const stmt = this.db.prepare(`
      SELECT * FROM pos_terminal_mappings
      WHERE store_id = ? AND active = 1
      ORDER BY terminal_type ASC, external_register_id ASC
    `);
    return stmt.all(storeId) as POSTerminalMapping[];
  }

  /**
   * Update terminal description
   * SEC-006: Parameterized UPDATE
   * DB-006: Store-scoped validation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param terminalId - Terminal mapping ID
   * @param description - New description
   * @returns Updated mapping or undefined if not found/not owned by store
   */
  updateDescription(
    storeId: string,
    terminalId: string,
    description: string | null
  ): POSTerminalMapping | undefined {
    // DB-006: Validate terminal belongs to store before update
    const existing = this.findByIdForStore(storeId, terminalId);
    if (!existing) {
      return undefined;
    }

    // SEC-006: Parameterized UPDATE
    const stmt = this.db.prepare(`
      UPDATE pos_terminal_mappings
      SET description = ?, updated_at = ?
      WHERE id = ? AND store_id = ?
    `);
    const result = stmt.run(description, this.now(), terminalId, storeId);

    if (result.changes === 0) {
      return undefined;
    }

    return this.findById(terminalId);
  }

  /**
   * Set terminal active status
   * SEC-006: Parameterized UPDATE
   * DB-006: Store-scoped validation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param terminalId - Terminal mapping ID
   * @param active - Active status (true/false)
   * @returns Updated mapping or undefined if not found/not owned by store
   */
  setActive(storeId: string, terminalId: string, active: boolean): POSTerminalMapping | undefined {
    // DB-006: Validate terminal belongs to store before update
    const existing = this.findByIdForStore(storeId, terminalId);
    if (!existing) {
      return undefined;
    }

    // SEC-006: Parameterized UPDATE
    const stmt = this.db.prepare(`
      UPDATE pos_terminal_mappings
      SET active = ?, updated_at = ?
      WHERE id = ? AND store_id = ?
    `);
    const result = stmt.run(active ? 1 : 0, this.now(), terminalId, storeId);

    if (result.changes === 0) {
      return undefined;
    }

    return this.findById(terminalId);
  }

  /**
   * Deactivate cloud-sourced registers that are no longer in the cloud response.
   * Only affects registers with pos_system_type = 'generic' (cloud-synced).
   * Registers created by POS data parsing (gilbarco, verifone, etc.) are never touched.
   *
   * SEC-006: Parameterized query with bound parameters
   * DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param activeExternalIds - Set of external_register_id values present in the current cloud response
   * @returns Number of registers deactivated
   */
  deactivateStaleCloudRegisters(storeId: string, activeExternalIds: Set<string>): number {
    // SEC-006: Parameterized query — storeId bound via prepared statement
    // Only target 'generic' pos_system_type (cloud-synced registers)
    const stmt = this.db.prepare(`
      SELECT id, external_register_id FROM pos_terminal_mappings
      WHERE store_id = ? AND pos_system_type = 'generic' AND active = 1
    `);
    const allCloudRegisters = stmt.all(storeId) as { id: string; external_register_id: string }[];

    let deactivated = 0;

    for (const reg of allCloudRegisters) {
      if (!activeExternalIds.has(reg.external_register_id)) {
        // SEC-006: Parameterized UPDATE
        const updateStmt = this.db.prepare(`
          UPDATE pos_terminal_mappings
          SET active = 0, updated_at = ?
          WHERE id = ? AND store_id = ?
        `);
        updateStmt.run(this.now(), reg.id, storeId);
        deactivated++;
      }
    }

    if (deactivated > 0) {
      log.info('Deactivated stale cloud-sourced registers', {
        storeId,
        deactivated,
        remainingActive: activeExternalIds.size,
      });
    }

    return deactivated;
  }

  /**
   * Infer terminal type from Gilbarco register ID pattern
   * Pattern: single digit = register, 5-digit starting with 10 = fuel dispenser
   */
  private inferTerminalType(externalRegisterId: string): TerminalType {
    // Gilbarco fuel dispenser pattern: starts with "10" and is 5 digits
    if (/^10\d{3}$/.test(externalRegisterId)) {
      return 'FUEL_DISPENSER';
    }
    return 'REGISTER';
  }

  /**
   * Backfill terminal mappings from existing shifts data
   * This populates pos_terminal_mappings from shifts that were processed
   * before the table was created (migration v007).
   *
   * Checks both external_register_id (new column) and register_id (old column)
   * to handle shifts created before and after migration v008.
   *
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Object with counts of created, existing, and total
   */
  backfillFromShifts(storeId: string): { created: number; existing: number; total: number } {
    // First, debug: check total shifts and their register IDs
    const debugStmt = this.db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN register_id IS NOT NULL AND register_id != '' THEN 1 ELSE 0 END) as with_reg_id,
             SUM(CASE WHEN external_register_id IS NOT NULL AND external_register_id != '' THEN 1 ELSE 0 END) as with_ext_reg_id
      FROM shifts WHERE store_id = ?
    `);
    const debugResult = debugStmt.get(storeId) as
      | { total: number; with_reg_id: number; with_ext_reg_id: number }
      | undefined;
    log.info('Shifts table debug info', {
      storeId,
      totalShifts: debugResult?.total ?? 0,
      shiftsWithRegisterId: debugResult?.with_reg_id ?? 0,
      shiftsWithExternalRegisterId: debugResult?.with_ext_reg_id ?? 0,
    });

    // Also log a sample of shifts to see their actual values
    const sampleStmt = this.db.prepare(`
      SELECT shift_id, register_id, external_register_id FROM shifts WHERE store_id = ? LIMIT 5
    `);
    const sampleShifts = sampleStmt.all(storeId);
    log.info('Sample shifts from database', { storeId, shifts: sampleShifts });

    // Get all unique register IDs from shifts for this store
    // Check both external_register_id (v008+) and register_id (older)
    const stmt = this.db.prepare(`
      SELECT DISTINCT
        CASE
          WHEN external_register_id IS NOT NULL AND external_register_id != ''
            THEN external_register_id
          WHEN register_id IS NOT NULL AND register_id != ''
            THEN register_id
          ELSE NULL
        END as reg_id
      FROM shifts
      WHERE store_id = ?
        AND (
          (external_register_id IS NOT NULL AND external_register_id != '')
          OR (register_id IS NOT NULL AND register_id != '')
        )
    `);
    const rows = stmt.all(storeId) as { reg_id: string | null }[];

    let created = 0;
    let existing = 0;

    for (const row of rows) {
      const externalRegisterId = row.reg_id;
      if (!externalRegisterId) continue;

      // Check if mapping already exists
      const existingMapping = this.findByExternalId(storeId, externalRegisterId);
      if (existingMapping) {
        existing++;
      } else {
        // Create new mapping
        this.getOrCreate(storeId, externalRegisterId);
        created++;
      }
    }

    log.info('Backfilled terminal mappings from shifts', {
      storeId,
      created,
      existing,
      total: rows.length,
    });

    return { created, existing, total: rows.length };
  }
}

// ============================================================================
// Fuel Position Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Fuel Position/Dispenser ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSFuelPositionMappingsDAL extends StoreBasedDAL<POSFuelPositionMapping> {
  protected readonly tableName = 'pos_fuel_position_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_position_id',
    'pump_number',
  ]);

  /**
   * Get or create a fuel position mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalPositionId: string,
    options?: {
      relatedTerminalMappingId?: string;
      pumpNumber?: number;
      description?: string;
      posSystemType?: POSSystemType;
    }
  ): POSFuelPositionMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalPositionId, posSystemType);
    if (existing) {
      return existing;
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // Infer pump number from position ID if not provided
    const pumpNumber = options?.pumpNumber ?? (parseInt(externalPositionId, 10) || null);

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_fuel_position_mappings (
        id, store_id, external_position_id, related_terminal_mapping_id,
        pump_number, description, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalPositionId,
      options?.relatedTerminalMappingId || null,
      pumpNumber,
      options?.description || null,
      posSystemType,
      now,
      now
    );

    log.info('Created fuel position mapping', {
      id,
      storeId,
      externalPositionId,
      pumpNumber,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created fuel position mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external position ID
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalPositionId: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSFuelPositionMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_fuel_position_mappings
      WHERE store_id = ? AND external_position_id = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalPositionId, posSystemType) as
      | POSFuelPositionMapping
      | undefined;
  }
}

// ============================================================================
// Till Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Till ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSTillMappingsDAL extends StoreBasedDAL<POSTillMapping> {
  protected readonly tableName = 'pos_till_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_till_id',
    'business_date',
  ]);

  /**
   * Get or create a till mapping for a specific business date
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalTillId: string,
    businessDate: string,
    options?: {
      shiftId?: string;
      relatedTerminalMappingId?: string;
      posSystemType?: POSSystemType;
    }
  ): POSTillMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalTillId, businessDate, posSystemType);
    if (existing) {
      // Update shift ID if provided and currently null
      if (options?.shiftId && !existing.shift_id) {
        this.linkToShift(existing.id, options.shiftId);
        existing.shift_id = options.shiftId;
      }
      return existing;
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_till_mappings (
        id, store_id, external_till_id, business_date, shift_id,
        related_terminal_mapping_id, pos_system_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalTillId,
      businessDate,
      options?.shiftId || null,
      options?.relatedTerminalMappingId || null,
      posSystemType,
      now,
      now
    );

    log.info('Created till mapping', {
      id,
      storeId,
      externalTillId,
      businessDate,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created till mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external till ID and business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalTillId: string,
    businessDate: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSTillMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_till_mappings
      WHERE store_id = ? AND external_till_id = ? AND business_date = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalTillId, businessDate, posSystemType) as
      | POSTillMapping
      | undefined;
  }

  /**
   * Link till mapping to a shift
   * SEC-006: Parameterized UPDATE
   */
  linkToShift(id: string, shiftId: string): void {
    const stmt = this.db.prepare(`
      UPDATE pos_till_mappings SET shift_id = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(shiftId, this.now(), id);
    log.info('Linked till mapping to shift', { mappingId: id, shiftId });
  }
}

// ============================================================================
// Fuel Grade Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Fuel Grade ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSFuelGradeMappingsDAL extends StoreBasedDAL<POSFuelGradeMapping> {
  protected readonly tableName = 'pos_fuel_grade_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_grade_id',
    'internal_grade_name',
    'fuel_type',
  ]);

  /**
   * Get or create a fuel grade mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalGradeId: string,
    options?: {
      internalGradeName?: string;
      fuelType?: FuelType;
      posSystemType?: POSSystemType;
    }
  ): POSFuelGradeMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalGradeId, posSystemType);
    if (existing) {
      return existing;
    }

    // Infer fuel type from Gilbarco grade ID pattern if not provided
    const fuelType = options?.fuelType ?? this.inferFuelType(externalGradeId);
    const gradeName = options?.internalGradeName ?? this.inferGradeName(externalGradeId);

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_fuel_grade_mappings (
        id, store_id, external_grade_id, internal_grade_name,
        fuel_type, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(id, storeId, externalGradeId, gradeName, fuelType, posSystemType, now, now);

    log.info('Created fuel grade mapping', {
      id,
      storeId,
      externalGradeId,
      fuelType,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created fuel grade mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external grade ID
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalGradeId: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSFuelGradeMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_fuel_grade_mappings
      WHERE store_id = ? AND external_grade_id = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalGradeId, posSystemType) as POSFuelGradeMapping | undefined;
  }

  /**
   * Infer fuel type from Gilbarco grade ID
   * Common Gilbarco patterns: 001=Regular, 002=Mid, 003=Premium, 021=Diesel, 300=DEF
   */
  private inferFuelType(externalGradeId: string): FuelType | null {
    const gradeMap: Record<string, FuelType> = {
      '001': 'REGULAR',
      '002': 'MIDGRADE',
      '003': 'PREMIUM',
      '021': 'DIESEL',
      '022': 'DIESEL',
      '300': 'DEF',
      '085': 'E85',
    };
    return gradeMap[externalGradeId] || null;
  }

  /**
   * Infer grade name from Gilbarco grade ID
   */
  private inferGradeName(externalGradeId: string): string | null {
    const nameMap: Record<string, string> = {
      '001': 'Regular Unleaded',
      '002': 'Mid-Grade',
      '003': 'Premium',
      '021': 'Diesel',
      '022': 'Diesel #2',
      '300': 'DEF',
      '085': 'E85',
    };
    return nameMap[externalGradeId] || null;
  }
}

// ============================================================================
// Fuel Product Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Fuel Product ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSFuelProductMappingsDAL extends StoreBasedDAL<POSFuelProductMapping> {
  protected readonly tableName = 'pos_fuel_product_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_product_id',
    'internal_product_name',
  ]);

  /**
   * Get or create a fuel product mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalProductId: string,
    options?: {
      internalProductName?: string;
      relatedGradeMappingId?: string;
      posSystemType?: POSSystemType;
    }
  ): POSFuelProductMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalProductId, posSystemType);
    if (existing) {
      return existing;
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_fuel_product_mappings (
        id, store_id, external_product_id, internal_product_name,
        related_grade_mapping_id, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalProductId,
      options?.internalProductName || null,
      options?.relatedGradeMappingId || null,
      posSystemType,
      now,
      now
    );

    log.info('Created fuel product mapping', {
      id,
      storeId,
      externalProductId,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created fuel product mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external product ID
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalProductId: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSFuelProductMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_fuel_product_mappings
      WHERE store_id = ? AND external_product_id = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalProductId, posSystemType) as POSFuelProductMapping | undefined;
  }
}

// ============================================================================
// Department Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Department/Merchandise Code mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSDepartmentMappingsDAL extends StoreBasedDAL<POSDepartmentMapping> {
  protected readonly tableName = 'pos_department_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_merch_code',
    'external_description',
  ]);

  /**
   * Get or create a department mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalMerchCode: string,
    options?: {
      departmentId?: string;
      externalDescription?: string;
      posSystemType?: POSSystemType;
    }
  ): POSDepartmentMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalMerchCode, posSystemType);
    if (existing) {
      return existing;
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_department_mappings (
        id, store_id, external_merch_code, external_description,
        department_id, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalMerchCode,
      options?.externalDescription || null,
      options?.departmentId || null,
      posSystemType,
      now,
      now
    );

    log.info('Created department mapping', {
      id,
      storeId,
      externalMerchCode,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created department mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external merchandise code
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalMerchCode: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSDepartmentMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_department_mappings
      WHERE store_id = ? AND external_merch_code = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalMerchCode, posSystemType) as POSDepartmentMapping | undefined;
  }

  /**
   * Link mapping to internal department
   * SEC-006: Parameterized UPDATE
   */
  linkToDepartment(id: string, departmentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE pos_department_mappings SET department_id = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(departmentId, this.now(), id);
    log.info('Linked department mapping', { mappingId: id, departmentId });
  }
}

// ============================================================================
// Tax Level Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Tax Level ID mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSTaxLevelMappingsDAL extends StoreBasedDAL<POSTaxLevelMapping> {
  protected readonly tableName = 'pos_tax_level_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_tax_level_id',
    'internal_tax_name',
  ]);

  /**
   * Get or create a tax level mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalTaxLevelId: string,
    options?: {
      internalTaxName?: string;
      taxRate?: number;
      jurisdiction?: string;
      posSystemType?: POSSystemType;
    }
  ): POSTaxLevelMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalTaxLevelId, posSystemType);
    if (existing) {
      return existing;
    }

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_tax_level_mappings (
        id, store_id, external_tax_level_id, internal_tax_name,
        tax_rate, jurisdiction, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalTaxLevelId,
      options?.internalTaxName || null,
      options?.taxRate ?? null,
      options?.jurisdiction || null,
      posSystemType,
      now,
      now
    );

    log.info('Created tax level mapping', {
      id,
      storeId,
      externalTaxLevelId,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created tax level mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external tax level ID
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalTaxLevelId: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSTaxLevelMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_tax_level_mappings
      WHERE store_id = ? AND external_tax_level_id = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalTaxLevelId, posSystemType) as POSTaxLevelMapping | undefined;
  }
}

// ============================================================================
// Tender Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Tender/Payment Method mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSTenderMappingsDAL extends StoreBasedDAL<POSTenderMapping> {
  protected readonly tableName = 'pos_tender_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_tender_code',
    'internal_tender_type',
  ]);

  /**
   * Get or create a tender mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalTenderCode: string,
    options?: {
      externalTenderSubcode?: string;
      tenderId?: string;
      internalTenderType?: TenderType;
      description?: string;
      posSystemType?: POSSystemType;
    }
  ): POSTenderMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';
    const subcode = options?.externalTenderSubcode || '';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalTenderCode, subcode, posSystemType);
    if (existing) {
      return existing;
    }

    // Infer tender type from Gilbarco code if not provided
    const tenderType = options?.internalTenderType ?? this.inferTenderType(externalTenderCode);

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_tender_mappings (
        id, store_id, external_tender_code, external_tender_subcode,
        tender_id, internal_tender_type, description, pos_system_type,
        active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalTenderCode,
      subcode || null,
      options?.tenderId || null,
      tenderType,
      options?.description || null,
      posSystemType,
      now,
      now
    );

    log.info('Created tender mapping', {
      id,
      storeId,
      externalTenderCode,
      tenderType,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created tender mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external tender code and subcode
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalTenderCode: string,
    externalTenderSubcode: string = '',
    posSystemType: POSSystemType = 'gilbarco'
  ): POSTenderMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_tender_mappings
      WHERE store_id = ? AND external_tender_code = ?
        AND (external_tender_subcode = ? OR (external_tender_subcode IS NULL AND ? = ''))
        AND pos_system_type = ?
    `);
    return stmt.get(
      storeId,
      externalTenderCode,
      externalTenderSubcode || null,
      externalTenderSubcode,
      posSystemType
    ) as POSTenderMapping | undefined;
  }

  /**
   * Infer tender type from Gilbarco tender code
   * Common codes: cash, outsideCredit, outsideDebit, insideCredit, fleet, etc.
   */
  private inferTenderType(externalTenderCode: string): TenderType | null {
    const code = externalTenderCode.toLowerCase();
    if (code === 'cash') return 'CASH';
    if (code.includes('credit')) return 'CREDIT';
    if (code.includes('debit')) return 'DEBIT';
    if (code.includes('ebt')) return 'EBT';
    if (code.includes('check')) return 'CHECK';
    if (code.includes('gift')) return 'GIFT';
    if (code.includes('fleet')) return 'FLEET';
    if (code.includes('loyalty')) return 'LOYALTY';
    return 'OTHER';
  }

  /**
   * Link mapping to internal tender
   * SEC-006: Parameterized UPDATE
   */
  linkToTender(id: string, tenderId: string): void {
    const stmt = this.db.prepare(`
      UPDATE pos_tender_mappings SET tender_id = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(tenderId, this.now(), id);
    log.info('Linked tender mapping', { mappingId: id, tenderId });
  }
}

// ============================================================================
// Price Tier Mapping DAL
// ============================================================================

/**
 * Data Access Layer for POS Price Tier mappings
 * SEC-006: All queries use parameterized statements
 * DB-006: All queries are store-scoped
 */
export class POSPriceTierMappingsDAL extends StoreBasedDAL<POSPriceTierMapping> {
  protected readonly tableName = 'pos_price_tier_mappings';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'external_tier_code',
    'tier_name',
    'tier_type',
  ]);

  /**
   * Get or create a price tier mapping
   * SEC-006: Parameterized queries
   * DB-006: Store-scoped
   */
  getOrCreate(
    storeId: string,
    externalTierCode: string,
    options?: {
      tierName?: string;
      tierType?: PriceTierType;
      priceDifferential?: number;
      posSystemType?: POSSystemType;
    }
  ): POSPriceTierMapping {
    const posSystemType = options?.posSystemType || 'gilbarco';

    // SEC-006: Parameterized lookup
    const existing = this.findByExternalId(storeId, externalTierCode, posSystemType);
    if (existing) {
      return existing;
    }

    // Infer tier type from Gilbarco code if not provided
    const tierType = options?.tierType ?? this.inferTierType(externalTierCode);
    const tierName = options?.tierName ?? this.inferTierName(externalTierCode);

    // Create new mapping
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized INSERT
    const stmt = this.db.prepare(`
      INSERT INTO pos_price_tier_mappings (
        id, store_id, external_tier_code, tier_name,
        tier_type, price_differential, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(
      id,
      storeId,
      externalTierCode,
      tierName,
      tierType,
      options?.priceDifferential ?? 0,
      posSystemType,
      now,
      now
    );

    log.info('Created price tier mapping', {
      id,
      storeId,
      externalTierCode,
      tierType,
      posSystemType,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created price tier mapping: ${id}`);
    }
    return created;
  }

  /**
   * Find mapping by external tier code
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  findByExternalId(
    storeId: string,
    externalTierCode: string,
    posSystemType: POSSystemType = 'gilbarco'
  ): POSPriceTierMapping | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM pos_price_tier_mappings
      WHERE store_id = ? AND external_tier_code = ? AND pos_system_type = ?
    `);
    return stmt.get(storeId, externalTierCode, posSystemType) as POSPriceTierMapping | undefined;
  }

  /**
   * Infer tier type from Gilbarco tier code
   * Common patterns: 0001=Cash, 0002=Credit
   */
  private inferTierType(externalTierCode: string): PriceTierType | null {
    const tierMap: Record<string, PriceTierType> = {
      '0001': 'CASH',
      '0002': 'CREDIT',
      '0003': 'FLEET',
      '0004': 'LOYALTY',
    };
    return tierMap[externalTierCode] || null;
  }

  /**
   * Infer tier name from Gilbarco tier code
   */
  private inferTierName(externalTierCode: string): string | null {
    const nameMap: Record<string, string> = {
      '0001': 'Cash Price',
      '0002': 'Credit Price',
      '0003': 'Fleet Price',
      '0004': 'Loyalty Price',
    };
    return nameMap[externalTierCode] || null;
  }
}

// ============================================================================
// Singleton Exports
// ============================================================================

export const posCashierMappingsDAL = new POSCashierMappingsDAL();
export const posTerminalMappingsDAL = new POSTerminalMappingsDAL();
export const posFuelPositionMappingsDAL = new POSFuelPositionMappingsDAL();
export const posTillMappingsDAL = new POSTillMappingsDAL();
export const posFuelGradeMappingsDAL = new POSFuelGradeMappingsDAL();
export const posFuelProductMappingsDAL = new POSFuelProductMappingsDAL();
export const posDepartmentMappingsDAL = new POSDepartmentMappingsDAL();
export const posTaxLevelMappingsDAL = new POSTaxLevelMappingsDAL();
export const posTenderMappingsDAL = new POSTenderMappingsDAL();
export const posPriceTierMappingsDAL = new POSPriceTierMappingsDAL();
