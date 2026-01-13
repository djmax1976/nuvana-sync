/**
 * Shifts Data Access Layer
 *
 * CRUD operations for shift management.
 * Shifts track POS operational periods within a business day.
 *
 * @module main/dal/shifts
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Shift status
 */
export type ShiftStatus = 'OPEN' | 'CLOSED';

/**
 * Shift entity
 */
export interface Shift extends StoreEntity {
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
 * Shift creation data
 */
export interface CreateShiftData {
  shift_id?: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id?: string;
  register_id?: string;
  start_time?: string;
}

/**
 * Shift update data
 */
export interface UpdateShiftData {
  cashier_id?: string | null;
  register_id?: string | null;
  end_time?: string;
  status?: ShiftStatus;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shifts-dal');

// ============================================================================
// Shifts DAL
// ============================================================================

/**
 * Data Access Layer for shift management
 */
export class ShiftsDAL extends StoreBasedDAL<Shift> {
  protected readonly tableName = 'shifts';
  protected readonly primaryKey = 'shift_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'business_date',
    'shift_number',
    'start_time',
    'end_time',
    'status',
  ]);

  /**
   * Create a new shift
   * SEC-006: Parameterized INSERT
   *
   * @param data - Shift creation data
   * @returns Created shift
   */
  create(data: CreateShiftData): Shift {
    const shiftId = data.shift_id || this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO shifts (
        shift_id, store_id, shift_number, business_date,
        cashier_id, register_id, start_time, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
    `);

    stmt.run(
      shiftId,
      data.store_id,
      data.shift_number,
      data.business_date,
      data.cashier_id || null,
      data.register_id || null,
      data.start_time || now,
      now,
      now
    );

    log.info('Shift created', {
      shiftId,
      storeId: data.store_id,
      shiftNumber: data.shift_number,
      businessDate: data.business_date,
    });

    const created = this.findById(shiftId);
    if (!created) {
      throw new Error(`Failed to retrieve created shift: ${shiftId}`);
    }
    return created;
  }

  /**
   * Update an existing shift
   * SEC-006: Parameterized UPDATE
   *
   * @param shiftId - Shift ID to update
   * @param data - Fields to update
   * @returns Updated shift or undefined
   */
  update(shiftId: string, data: UpdateShiftData): Shift | undefined {
    const now = this.now();

    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.cashier_id !== undefined) {
      updates.push('cashier_id = ?');
      params.push(data.cashier_id);
    }
    if (data.register_id !== undefined) {
      updates.push('register_id = ?');
      params.push(data.register_id);
    }
    if (data.end_time !== undefined) {
      updates.push('end_time = ?');
      params.push(data.end_time);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    params.push(shiftId);

    const stmt = this.db.prepare(`
      UPDATE shifts SET ${updates.join(', ')} WHERE shift_id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      return undefined;
    }

    return this.findById(shiftId);
  }

  /**
   * Close a shift
   * SEC-006: Parameterized UPDATE
   *
   * @param shiftId - Shift ID to close
   * @param endTime - Optional end time (defaults to now)
   * @returns Closed shift or undefined
   */
  close(shiftId: string, endTime?: string): Shift | undefined {
    return this.update(shiftId, {
      status: 'CLOSED',
      end_time: endTime || this.now(),
    });
  }

  /**
   * Find shifts by business date
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Array of shifts for the date
   */
  findByDate(storeId: string, businessDate: string): Shift[] {
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date = ?
      ORDER BY shift_number ASC
    `);
    return stmt.all(storeId, businessDate) as Shift[];
  }

  /**
   * Find shifts by date range
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @returns Array of shifts in range
   */
  findByDateRange(storeId: string, startDate: string, endDate: string): Shift[] {
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, shift_number ASC
    `);
    return stmt.all(storeId, startDate, endDate) as Shift[];
  }

  /**
   * Get the currently open shift for a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Open shift or undefined
   */
  getOpenShift(storeId: string): Shift | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND status = 'OPEN'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as Shift | undefined;
  }

  /**
   * Get the latest shift for a store (regardless of status)
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Latest shift or undefined
   */
  getLatestShift(storeId: string): Shift | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ?
      ORDER BY business_date DESC, shift_number DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as Shift | undefined;
  }

  /**
   * Get the next shift number for a business date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Next shift number (1 if no shifts exist)
   */
  getNextShiftNumber(storeId: string, businessDate: string): number {
    const stmt = this.db.prepare(`
      SELECT MAX(shift_number) as max_num FROM shifts
      WHERE store_id = ? AND business_date = ?
    `);
    const result = stmt.get(storeId, businessDate) as { max_num: number | null } | undefined;
    return (result?.max_num || 0) + 1;
  }

  /**
   * Find shift by store, date, and shift number
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param shiftNumber - Shift number
   * @returns Shift or undefined
   */
  findByNumber(storeId: string, businessDate: string, shiftNumber: number): Shift | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date = ? AND shift_number = ?
    `);
    return stmt.get(storeId, businessDate, shiftNumber) as Shift | undefined;
  }

  /**
   * Count shifts by status for a store
   *
   * @param storeId - Store identifier
   * @param status - Shift status
   * @returns Count of shifts with status
   */
  countByStatus(storeId: string, status: ShiftStatus): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM shifts
      WHERE store_id = ? AND status = ?
    `);
    const result = stmt.get(storeId, status) as { count: number } | undefined;
    return result?.count ?? 0;
  }

  /**
   * Get or create shift for current business date
   * Creates a new open shift if none exists
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Open shift for the date
   */
  getOrCreateForDate(storeId: string, businessDate: string): Shift {
    // Check for existing open shift on this date
    const existingShifts = this.findByDate(storeId, businessDate);
    const openShift = existingShifts.find((s) => s.status === 'OPEN');

    if (openShift) {
      return openShift;
    }

    // Create new shift
    const shiftNumber = this.getNextShiftNumber(storeId, businessDate);
    return this.create({
      store_id: storeId,
      shift_number: shiftNumber,
      business_date: businessDate,
    });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift operations
 */
export const shiftsDAL = new ShiftsDAL();
