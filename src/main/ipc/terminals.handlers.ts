/**
 * Terminals IPC Handlers
 *
 * Provides terminal/register management endpoints.
 * Returns registers identified during onboarding with their active shift status.
 *
 * @module main/ipc/terminals
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 * @security API-001: Schema validation for all inputs
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import { posTerminalMappingsDAL, type POSTerminalMapping } from '../dal/pos-id-mappings.dal';
import { shiftsDAL, type Shift } from '../dal/shifts.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Register with associated shift information
 * Combines terminal mapping data with current shift status
 */
interface RegisterWithShiftStatus {
  /** Internal terminal mapping ID */
  id: string;
  /** External register ID from POS system */
  external_register_id: string;
  /** Terminal type (always REGISTER for this endpoint) */
  terminal_type: string;
  /** User-friendly description/name */
  description: string | null;
  /** Whether the register is active */
  active: boolean;
  /** Currently open shift on this register, if any */
  activeShift: Shift | null;
  /** Count of open shifts for this register */
  openShiftCount: number;
  /** When this register was first identified */
  created_at: string;
  /** When this register was last updated */
  updated_at: string;
}

interface RegisterListResponse {
  registers: RegisterWithShiftStatus[];
  total: number;
}

// UpdateRegisterParams defined inline in UpdateRegisterSchema

// ============================================================================
// Input Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

const RegisterIdSchema = z.string().uuid();

const UpdateRegisterSchema = z.object({
  registerId: z.string().uuid(),
  description: z.string().max(255).optional(),
});

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('terminals-handlers');

// ============================================================================
// List Registers Handler
// ============================================================================

/**
 * List all registers for the configured store with their active shift status
 *
 * Performance characteristics:
 * - Single query to pos_terminal_mappings (indexed by store_id, terminal_type)
 * - Single query to shifts for open shifts (indexed by store_id, status)
 * - In-memory join to avoid N+1 queries
 * - O(n + m) where n = registers, m = open shifts
 *
 * Security:
 * - SEC-006: All queries use parameterized statements via DAL
 * - DB-006: All queries scoped to configured store
 */
registerHandler<RegisterListResponse | ReturnType<typeof createErrorResponse>>(
  'terminals:list',
  async (_event) => {
    // Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();

    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // DB-006: Store-scoped query for registers
      // SEC-006: Parameterized query via DAL
      const terminals = posTerminalMappingsDAL.findRegisters(store.store_id);

      log.debug('Registers query result', {
        storeId: store.store_id,
        registerCount: terminals.length,
      });

      // Get all open shifts for this store in a single query to avoid N+1
      // DB-006: Store-scoped query
      // SEC-006: Parameterized query via DAL
      // Performance: Single query with index on (store_id, status)
      const openShiftsResult = shiftsDAL.findByStore(
        store.store_id,
        { limit: 1000 }, // Reasonable upper bound for open shifts
        { column: 'created_at', direction: 'DESC' }
      );

      // Filter to only open shifts in memory (more efficient than multiple queries)
      // Use end_time IS NULL as primary indicator (more reliable than status field)
      const openShifts = openShiftsResult.data.filter((s) => s.end_time === null);

      // Build a map of register_id -> open shifts for O(1) lookup
      // This avoids N+1 queries by doing a single pass
      const shiftsByRegister = new Map<string, Shift[]>();
      for (const shift of openShifts) {
        const registerId = shift.external_register_id || shift.register_id || 'default';
        const existing = shiftsByRegister.get(registerId) || [];
        existing.push(shift);
        shiftsByRegister.set(registerId, existing);
      }

      // Map terminals to response format with shift status
      const registers: RegisterWithShiftStatus[] = terminals.map((terminal) => {
        const shiftsForRegister = shiftsByRegister.get(terminal.external_register_id) || [];
        // Get most recent open shift (shifts are ordered by created_at DESC)
        const activeShift = shiftsForRegister.length > 0 ? shiftsForRegister[0] : null;

        return {
          id: terminal.id,
          external_register_id: terminal.external_register_id,
          terminal_type: terminal.terminal_type,
          description: terminal.description,
          active: terminal.active === 1,
          activeShift,
          openShiftCount: shiftsForRegister.length,
          created_at: terminal.created_at,
          updated_at: terminal.updated_at,
        };
      });

      log.debug('Registers listed with shift status', {
        storeId: store.store_id,
        registerCount: registers.length,
        openShiftCount: openShifts.length,
      });

      return {
        registers,
        total: registers.length,
      };
    } catch (error) {
      log.error('Failed to list registers', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'List all registers with their active shift status' }
);

// ============================================================================
// Get Register by ID Handler
// ============================================================================

/**
 * Get a single register by ID with its active shift status
 */
registerHandler<RegisterWithShiftStatus | ReturnType<typeof createErrorResponse>>(
  'terminals:getById',
  async (_event, registerIdInput: unknown) => {
    // API-001: Validate register ID
    const parseResult = RegisterIdSchema.safeParse(registerIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid register ID format');
    }

    const registerId = parseResult.data;

    // Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // DB-006: Store-scoped query to ensure tenant isolation
      // SEC-006: Parameterized query via DAL
      const terminal = posTerminalMappingsDAL.findByIdForStore(store.store_id, registerId);

      if (!terminal) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Register not found');
      }

      // Get open shifts for this specific register
      const openShiftsResult = shiftsDAL.findByStore(
        store.store_id,
        { limit: 100 },
        { column: 'created_at', direction: 'DESC' }
      );

      // Use end_time IS NULL as primary indicator (more reliable than status field)
      const shiftsForRegister = openShiftsResult.data.filter(
        (s) =>
          s.end_time === null &&
          (s.external_register_id === terminal.external_register_id ||
            s.register_id === terminal.external_register_id)
      );

      const activeShift = shiftsForRegister.length > 0 ? shiftsForRegister[0] : null;

      return {
        id: terminal.id,
        external_register_id: terminal.external_register_id,
        terminal_type: terminal.terminal_type,
        description: terminal.description,
        active: terminal.active === 1,
        activeShift,
        openShiftCount: shiftsForRegister.length,
        created_at: terminal.created_at,
        updated_at: terminal.updated_at,
      };
    } catch (error) {
      log.error('Failed to get register', {
        registerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get a single register by ID with shift status' }
);

// ============================================================================
// Update Register Handler
// ============================================================================

/**
 * Update a register's description
 * Requires shift_manager or higher role
 */
registerHandler<POSTerminalMapping | ReturnType<typeof createErrorResponse>>(
  'terminals:update',
  async (_event, paramsInput: unknown) => {
    // API-001: Validate input parameters
    const parseResult = UpdateRegisterSchema.safeParse(paramsInput);
    if (!parseResult.success) {
      log.warn('Invalid update register params', { errors: parseResult.error.issues });
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const params = parseResult.data;

    // Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // DB-006: Store-scoped update via DAL
      // SEC-006: Parameterized query via DAL
      const updated = posTerminalMappingsDAL.updateDescription(
        store.store_id,
        params.registerId,
        params.description ?? null
      );

      if (!updated) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Register not found');
      }

      log.info('Register updated', {
        registerId: params.registerId,
        storeId: store.store_id,
      });

      return updated;
    } catch (error) {
      log.error('Failed to update register', {
        registerId: params.registerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Update register description',
  }
);

log.info('Terminals handlers registered');
