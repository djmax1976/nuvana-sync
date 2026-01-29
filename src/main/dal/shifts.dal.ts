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
  /** External cashier ID from POS (for reference/debugging) */
  external_cashier_id: string | null;
  /** External register ID from POS (for reference/debugging) */
  external_register_id: string | null;
  /** External till ID from POS (for reference/debugging) */
  external_till_id: string | null;
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
  /** Internal user ID (FK to users table) - must be valid user_id or null */
  cashier_id?: string;
  /** Internal register ID - must be valid or null */
  register_id?: string;
  start_time?: string;
  /** External cashier ID from POS (for reference/debugging) */
  external_cashier_id?: string;
  /** External register ID from POS (for reference/debugging) */
  external_register_id?: string;
  /** External till ID from POS (for reference/debugging) */
  external_till_id?: string;
}

/**
 * Shift update data
 */
export interface UpdateShiftData {
  /** Internal user ID (FK to users table) - must be valid user_id or null */
  cashier_id?: string | null;
  /** Internal register ID - must be valid or null */
  register_id?: string | null;
  end_time?: string;
  status?: ShiftStatus;
  /** External cashier ID from POS (for reference/debugging) */
  external_cashier_id?: string | null;
  /** External register ID from POS (for reference/debugging) */
  external_register_id?: string | null;
  /** External till ID from POS (for reference/debugging) */
  external_till_id?: string | null;
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
        external_cashier_id, external_register_id, external_till_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      shiftId,
      data.store_id,
      data.shift_number,
      data.business_date,
      data.cashier_id || null,
      data.register_id || null,
      data.start_time || now,
      data.external_cashier_id || null,
      data.external_register_id || null,
      data.external_till_id || null,
      now,
      now
    );

    log.info('Shift created', {
      shiftId,
      storeId: data.store_id,
      shiftNumber: data.shift_number,
      businessDate: data.business_date,
      externalCashierId: data.external_cashier_id,
      externalRegisterId: data.external_register_id,
    });

    const created = this.findById(shiftId);
    if (!created) {
      throw new Error(`Failed to retrieve created shift: ${shiftId}`);
    }
    return created;
  }

  /**
   * Create a new shift directly as CLOSED
   * SEC-006: Parameterized INSERT
   *
   * Used when processing shift-close files where no prior open shift exists.
   * The POS has already closed the shift, so we create it with CLOSED status.
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param options - Shift details from the close file
   * @returns Created closed shift
   */
  createClosedShift(
    storeId: string,
    businessDate: string,
    options: {
      externalCashierId?: string;
      externalRegisterId?: string;
      externalTillId?: string;
      internalUserId?: string;
      startTime?: string;
      endTime: string;
    }
  ): Shift {
    const shiftId = this.generateId();
    const now = this.now();
    const shiftNumber = this.getNextShiftNumber(storeId, businessDate);

    const stmt = this.db.prepare(`
      INSERT INTO shifts (
        shift_id, store_id, shift_number, business_date,
        cashier_id, register_id, start_time, end_time, status,
        external_cashier_id, external_register_id, external_till_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      shiftId,
      storeId,
      shiftNumber,
      businessDate,
      options.internalUserId || null,
      null, // register_id - no internal mapping yet
      options.startTime || now,
      options.endTime,
      options.externalCashierId || null,
      options.externalRegisterId || null,
      options.externalTillId || null,
      now,
      now
    );

    log.info('Closed shift created directly', {
      shiftId,
      storeId,
      shiftNumber,
      businessDate,
      externalRegisterId: options.externalRegisterId,
      endTime: options.endTime,
    });

    const created = this.findById(shiftId);
    if (!created) {
      throw new Error(`Failed to retrieve created closed shift: ${shiftId}`);
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
    // External ID updates
    if (data.external_cashier_id !== undefined) {
      updates.push('external_cashier_id = ?');
      params.push(data.external_cashier_id);
    }
    if (data.external_register_id !== undefined) {
      updates.push('external_register_id = ?');
      params.push(data.external_register_id);
    }
    if (data.external_till_id !== undefined) {
      updates.push('external_till_id = ?');
      params.push(data.external_till_id);
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
   * Close a shift (legacy method - use closeShift for new code)
   * SEC-006: Parameterized UPDATE
   *
   * @deprecated Use closeShift() instead which has proper guards
   * @param shiftId - Shift ID to close
   * @param endTime - Optional end time (defaults to now)
   * @returns Closed shift or undefined
   */
  close(shiftId: string, endTime?: string): Shift | undefined {
    return this.closeShift(shiftId, endTime);
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
   * SEC-006: Parameterized query
   *
   * Uses end_time IS NULL as the primary indicator of an open shift.
   * This is more reliable than status='OPEN' because:
   * 1. Timestamps are set when shifts actually close
   * 2. Avoids issues where status field may not be updated
   * 3. Matches the approach used in bmad backend
   *
   * @param storeId - Store identifier
   * @returns Open shift or undefined
   */
  getOpenShift(storeId: string): Shift | undefined {
    // Primary detection: end_time IS NULL (shift not yet closed)
    // Secondary ordering: most recent start_time (for multiple open shifts edge case)
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND end_time IS NULL
      ORDER BY start_time DESC, created_at DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as Shift | undefined;
  }

  /**
   * Get open shift for a specific business date
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * More specific lookup that considers business date for shift matching.
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Open shift for the date or undefined
   */
  getOpenShiftForDate(storeId: string, businessDate: string): Shift | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date = ? AND end_time IS NULL
      ORDER BY shift_number DESC
      LIMIT 1
    `);
    return stmt.get(storeId, businessDate) as Shift | undefined;
  }

  /**
   * Get open shift matching specific criteria (register, cashier, date)
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * Provides precise shift matching for associating XML data with the correct shift.
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param options - Optional register/cashier filters
   * @returns Matching open shift or undefined
   */
  findOpenShiftByCriteria(
    storeId: string,
    businessDate: string,
    options?: { registerId?: string; cashierId?: string }
  ): Shift | undefined {
    // Build query with optional filters
    let query = `
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date = ? AND end_time IS NULL
    `;
    const params: unknown[] = [storeId, businessDate];

    // Add optional register filter if register_id is set on the shift
    if (options?.registerId) {
      query += ` AND (register_id = ? OR register_id IS NULL)`;
      params.push(options.registerId);
    }

    // Add optional cashier filter if cashier_id is set on the shift
    if (options?.cashierId) {
      query += ` AND (cashier_id = ? OR cashier_id IS NULL)`;
      params.push(options.cashierId);
    }

    query += ` ORDER BY shift_number DESC LIMIT 1`;

    const stmt = this.db.prepare(query);
    return stmt.get(...params) as Shift | undefined;
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
   * Count open shifts for a business date, excluding a specific shift
   *
   * Used to determine if closing a shift results in a day close (0 remaining)
   * or just a shift close (>0 remaining).
   *
   * SEC-006: Parameterized query - no string concatenation
   * DB-006: Store-scoped query via storeId parameter
   *
   * Performance: O(1) via COUNT on indexed columns (store_id, business_date)
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date (YYYY-MM-DD)
   * @param excludeShiftId - Shift ID to exclude from count (the one being closed)
   * @returns Count of open shifts excluding the specified shift
   */
  countOpenShiftsExcluding(storeId: string, businessDate: string, excludeShiftId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM shifts
      WHERE store_id = ? AND business_date = ? AND end_time IS NULL AND shift_id != ?
    `);
    const result = stmt.get(storeId, businessDate, excludeShiftId) as { count: number } | undefined;
    return result?.count ?? 0;
  }

  /**
   * Get or create shift for current business date and register
   * Creates a new open shift if none exists for this register.
   * For NAXML polling stores, register/cashier data comes from XML.
   *
   * Uses end_time IS NULL for open shift detection (not status field).
   *
   * IMPORTANT: This method accepts EXTERNAL POS IDs (not internal UUIDs).
   * - External IDs are stored in external_* columns for reference/debugging
   * - Internal cashier_id/register_id are left NULL unless internal_user_id is provided
   * - This ensures FK constraint to users table is not violated
   *
   * IMPORTANT: Shifts are matched by (store_id, business_date, external_register_id)
   * to ensure only ONE open shift exists per register per day.
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param options - Optional external IDs from XML and internal mappings
   * @returns Open shift for the date and register
   */
  getOrCreateForDate(
    storeId: string,
    businessDate: string,
    options?: {
      /** External register ID from POS XML (stored in external_register_id) */
      externalRegisterId?: string;
      /** External cashier ID from POS XML (stored in external_cashier_id) */
      externalCashierId?: string;
      /** External till ID from POS XML (stored in external_till_id) */
      externalTillId?: string;
      /** Internal user ID from mapping (FK to users table) */
      internalUserId?: string;
      startTime?: string;
    }
  ): Shift {
    // Check for existing open shift on this date AND register using end_time IS NULL
    // This ensures we don't create duplicate shifts for the same register
    const openShift = this.findOpenShiftByRegister(
      storeId,
      businessDate,
      options?.externalRegisterId
    );

    if (openShift) {
      // Update external IDs if provided and currently null (first XML with this data)
      const updates: UpdateShiftData = {};

      if (options?.externalCashierId && !openShift.external_cashier_id) {
        updates.external_cashier_id = options.externalCashierId;
      }
      if (options?.externalTillId && !openShift.external_till_id) {
        updates.external_till_id = options.externalTillId;
      }
      // Only update internal cashier_id if we have a valid internal_user_id
      if (options?.internalUserId && !openShift.cashier_id) {
        updates.cashier_id = options.internalUserId;
      }

      if (Object.keys(updates).length > 0) {
        const updated = this.update(openShift.shift_id, updates);
        if (updated) {
          log.debug('Shift updated with XML data', {
            shiftId: openShift.shift_id,
            externalCashierId: updates.external_cashier_id,
            externalRegisterId: openShift.external_register_id,
            internalUserId: updates.cashier_id,
          });
          return updated;
        }
      }
      return openShift;
    }

    // Create new shift with external IDs from POS
    const shiftNumber = this.getNextShiftNumber(storeId, businessDate);
    return this.create({
      store_id: storeId,
      shift_number: shiftNumber,
      business_date: businessDate,
      // Internal IDs (FK-safe) - only set if we have valid internal mapping
      cashier_id: options?.internalUserId,
      register_id: undefined, // No internal register mapping yet
      start_time: options?.startTime,
      // External IDs (for reference/debugging)
      external_cashier_id: options?.externalCashierId,
      external_register_id: options?.externalRegisterId,
      external_till_id: options?.externalTillId,
    });
  }

  /**
   * Find open shift for a specific register on a business date
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * Matches by external_register_id to ensure only one open shift per register.
   * If no register ID is provided, falls back to date-only matching.
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date (YYYY-MM-DD)
   * @param externalRegisterId - External register ID from POS (optional)
   * @returns Open shift for the register or undefined
   */
  findOpenShiftByRegister(
    storeId: string,
    businessDate: string,
    externalRegisterId?: string
  ): Shift | undefined {
    if (externalRegisterId) {
      // Match by register ID - ensures one shift per register per day
      const stmt = this.db.prepare(`
        SELECT * FROM shifts
        WHERE store_id = ? AND business_date = ? AND external_register_id = ? AND end_time IS NULL
        ORDER BY shift_number DESC
        LIMIT 1
      `);
      const shift = stmt.get(storeId, businessDate, externalRegisterId) as Shift | undefined;
      if (shift) {
        return shift;
      }
      // No shift for this register yet - return undefined to create new one
      return undefined;
    }

    // Fallback: no register ID provided, use date-only matching
    return this.getOpenShiftForDate(storeId, businessDate);
  }

  /**
   * Find shift by date and register (regardless of open/closed status)
   * Used for Period 98 shift close files to find the shift to close.
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date (YYYY-MM-DD)
   * @param externalRegisterId - External register ID from POS (optional)
   * @returns Most recent shift for the date/register or undefined
   */
  findShiftByDateAndRegister(
    storeId: string,
    businessDate: string,
    externalRegisterId?: string
  ): Shift | undefined {
    if (externalRegisterId) {
      // Match by register ID - get most recent shift for this register on this date
      const stmt = this.db.prepare(`
        SELECT * FROM shifts
        WHERE store_id = ? AND business_date = ? AND external_register_id = ?
        ORDER BY shift_number DESC
        LIMIT 1
      `);
      return stmt.get(storeId, businessDate, externalRegisterId) as Shift | undefined;
    }

    // Fallback: no register ID provided, get most recent shift for the date
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date = ?
      ORDER BY shift_number DESC
      LIMIT 1
    `);
    return stmt.get(storeId, businessDate) as Shift | undefined;
  }

  /**
   * Find an OPEN shift to close, checking adjacent business dates for overnight shifts.
   *
   * This handles the overnight shift scenario where:
   * - Shift opens at 11:59 PM on Jan 9 (business_date = "2025-01-09")
   * - Close file arrives with adjusted date of Jan 10 (due to adjustBusinessDate logic)
   * - Need to find the open shift on Jan 9 even when looking for Jan 10
   *
   * Priority:
   * 1. First check the exact business date for an OPEN shift
   * 2. If not found, check the previous day for an OPEN shift (overnight scenario)
   *
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from close file (YYYY-MM-DD)
   * @param externalRegisterId - External register ID from POS (optional)
   * @returns Open shift to close, or undefined if none found
   */
  findOpenShiftToClose(
    storeId: string,
    businessDate: string,
    externalRegisterId?: string
  ): Shift | undefined {
    // First, try exact date match for an OPEN shift
    const exactMatch = this.findOpenShiftOnDate(storeId, businessDate, externalRegisterId);
    if (exactMatch) {
      return exactMatch;
    }

    // For overnight shifts: check the previous business day
    // This handles shifts that opened late (e.g., 11:59 PM) on the previous day
    const previousDate = this.getPreviousDate(businessDate);
    const previousDayMatch = this.findOpenShiftOnDate(storeId, previousDate, externalRegisterId);
    if (previousDayMatch) {
      log.info('Found overnight shift to close on previous business day', {
        requestedDate: businessDate,
        actualShiftDate: previousDate,
        shiftId: previousDayMatch.shift_id,
        externalRegisterId,
      });
      return previousDayMatch;
    }

    return undefined;
  }

  /**
   * Find an OPEN shift on a specific date
   * SEC-006: Parameterized query
   */
  private findOpenShiftOnDate(
    storeId: string,
    businessDate: string,
    externalRegisterId?: string
  ): Shift | undefined {
    if (externalRegisterId) {
      const stmt = this.db.prepare(`
        SELECT * FROM shifts
        WHERE store_id = ? AND business_date = ? AND external_register_id = ? AND end_time IS NULL
        ORDER BY shift_number DESC
        LIMIT 1
      `);
      return stmt.get(storeId, businessDate, externalRegisterId) as Shift | undefined;
    }

    // No register ID - find any open shift on this date
    const stmt = this.db.prepare(`
      SELECT * FROM shifts
      WHERE store_id = ? AND business_date = ? AND end_time IS NULL
      ORDER BY shift_number DESC
      LIMIT 1
    `);
    return stmt.get(storeId, businessDate) as Shift | undefined;
  }

  /**
   * Get the previous date (subtract one day)
   * @param dateStr - Date in YYYY-MM-DD format
   * @returns Previous date in YYYY-MM-DD format
   */
  private getPreviousDate(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00Z'); // Use noon to avoid timezone issues
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().split('T')[0];
  }

  /**
   * Close a shift by setting end_time and status
   * SEC-006: Parameterized UPDATE
   *
   * This method properly closes a shift by:
   * 1. Setting end_time timestamp (primary indicator)
   * 2. Setting status to 'CLOSED' (secondary indicator)
   *
   * @param shiftId - Shift ID to close
   * @param endTime - Optional end time (defaults to now)
   * @returns Closed shift or undefined if not found
   */
  closeShift(shiftId: string, endTime?: string): Shift | undefined {
    const closeTime = endTime || this.now();

    // SEC-006: Parameterized UPDATE
    const stmt = this.db.prepare(`
      UPDATE shifts
      SET end_time = ?, status = 'CLOSED', updated_at = ?
      WHERE shift_id = ? AND end_time IS NULL
    `);

    const result = stmt.run(closeTime, this.now(), shiftId);

    if (result.changes === 0) {
      log.warn('Shift not found or already closed', { shiftId });
      return undefined;
    }

    log.info('Shift closed', { shiftId, endTime: closeTime });
    return this.findById(shiftId);
  }

  /**
   * Close shift by business date criteria
   * Used when processing shift-close files (Period 98) to close matching shifts.
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param endTime - End time from the shift-close file
   * @param options - Optional register/cashier to match specific shift
   * @returns Closed shift or undefined
   */
  closeShiftForDate(
    storeId: string,
    businessDate: string,
    endTime: string,
    options?: { registerId?: string; cashierId?: string }
  ): Shift | undefined {
    // Find matching open shift
    const openShift = this.findOpenShiftByCriteria(storeId, businessDate, options);

    if (!openShift) {
      log.warn('No open shift found to close', { storeId, businessDate, options });
      return undefined;
    }

    return this.closeShift(openShift.shift_id, endTime);
  }
  /**
   * Close all stale open shifts (shifts with end_time IS NULL that are older than today)
   * This fixes data corruption from previous bugs where shifts weren't properly closed.
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param currentDate - Current business date (YYYY-MM-DD) - shifts before this are considered stale
   * @returns Number of shifts closed
   */
  closeStaleOpenShifts(storeId: string, currentDate: string): number {
    // Find all open shifts older than currentDate
    const findStmt = this.db.prepare(`
      SELECT shift_id, business_date FROM shifts
      WHERE store_id = ? AND end_time IS NULL AND business_date < ?
    `);
    const staleShifts = findStmt.all(storeId, currentDate) as Array<{
      shift_id: string;
      business_date: string;
    }>;

    if (staleShifts.length === 0) {
      return 0;
    }

    log.info('Closing stale open shifts', {
      storeId,
      currentDate,
      staleCount: staleShifts.length,
      staleDates: staleShifts.map((s) => s.business_date),
    });

    // Close each stale shift - set end_time to end of business day
    const updateStmt = this.db.prepare(`
      UPDATE shifts
      SET end_time = business_date || 'T23:59:59', status = 'CLOSED', updated_at = ?
      WHERE shift_id = ? AND end_time IS NULL
    `);

    const now = this.now();
    let closedCount = 0;

    for (const shift of staleShifts) {
      const result = updateStmt.run(now, shift.shift_id);
      if (result.changes > 0) {
        closedCount++;
      }
    }

    log.info('Stale shifts closed', { closedCount, storeId });
    return closedCount;
  }

  /**
   * Get day status for determining if day close is available
   *
   * Returns business day status in a single optimized query that:
   * - Counts total shifts for the date (day has started)
   * - Counts open shifts (day close available)
   * - Determines the current business date from most recent shift
   *
   * Performance: O(1) via COUNT with indexed columns (store_id, business_date, end_time)
   * Uses a single query with conditional aggregation to minimize DB round trips.
   *
   * SEC-006: Parameterized query - no string concatenation
   * DB-006: Store-scoped query via storeId parameter
   *
   * @param storeId - Store identifier for tenant isolation
   * @param businessDate - Business date to check (YYYY-MM-DD)
   * @returns Day status with shift counts and flags
   */
  getDayStatus(
    storeId: string,
    businessDate: string
  ): {
    /** Whether any shifts exist for this date (day has started) */
    dayStarted: boolean;
    /** Whether there are open shifts (day close available) */
    hasOpenShifts: boolean;
    /** Count of currently open shifts */
    openShiftCount: number;
    /** Total shift count for the date */
    totalShiftCount: number;
    /** Business date checked */
    businessDate: string;
  } {
    // Single optimized query with conditional aggregation
    // SEC-006: Parameterized query with bound parameters
    // Performance: Uses COUNT with indexed columns, no full table scan
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_shifts,
        SUM(CASE WHEN end_time IS NULL THEN 1 ELSE 0 END) as open_shifts
      FROM shifts
      WHERE store_id = ? AND business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as
      | {
          total_shifts: number;
          open_shifts: number;
        }
      | undefined;

    const totalShiftCount = result?.total_shifts ?? 0;
    const openShiftCount = result?.open_shifts ?? 0;

    log.debug('Day status retrieved', {
      storeId,
      businessDate,
      totalShiftCount,
      openShiftCount,
    });

    return {
      dayStarted: totalShiftCount > 0,
      hasOpenShifts: openShiftCount > 0,
      openShiftCount,
      totalShiftCount,
      businessDate,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift operations
 */
export const shiftsDAL = new ShiftsDAL();
