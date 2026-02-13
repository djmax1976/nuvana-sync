/**
 * Day Close IPC Handlers
 *
 * Provides day close access validation endpoint.
 * Centralizes all day close access rules in one place.
 *
 * @module main/ipc/day-close
 * @security SEC-010: Authorization enforced server-side
 * @security SEC-006: All queries use parameterized statements
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-017: Audit trail for access attempts
 * @security API-001: Input validation via Zod schema
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import {
  checkAccess,
  type DayCloseAccessResult,
  type DayCloseAccessInput,
} from '../services/day-close-access.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Input Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

/**
 * Day close access check input schema
 * SEC-014: PIN validated as 4-6 digits
 */
const DayCloseAccessInputSchema = z.object({
  pin: z
    .string()
    .min(4, 'PIN must be at least 4 digits')
    .max(6, 'PIN must be at most 6 digits')
    .regex(/^\d+$/, 'PIN must contain only digits'),
});

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('day-close-handlers');

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Check Day Close Access
 *
 * Validates all conditions for day close access:
 * 1. User is authenticated via PIN (BR-005)
 * 2. Exactly one open shift exists (BR-001, BR-002)
 * 3. User is shift owner OR has override role (BR-003, BR-004)
 *
 * This handler is called when:
 * - User navigates to /day-close route
 * - DayCloseAccessGuard prompts for PIN
 *
 * @security SEC-010: Authorization enforced server-side
 * @security SEC-006: Parameterized queries via service/DAL
 * @security DB-006: Store-scoped queries via configured store
 * @security SEC-017: Audit trail for access attempts
 * @security API-001: Input validation via Zod
 *
 * Channel: dayClose:checkAccess
 */
registerHandler<DayCloseAccessResult | ReturnType<typeof createErrorResponse>>(
  'dayClose:checkAccess',
  async (_event, inputRaw: unknown) => {
    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.warn('Day close access check failed: Store not configured');
      return createErrorResponse(
        IPCErrorCodes.NOT_CONFIGURED,
        'Store not configured. Please complete setup first.'
      );
    }

    // API-001: Validate input
    const parseResult = DayCloseAccessInputSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      log.warn('Day close access check failed: Invalid input', {
        errors: parseResult.error.issues,
      });
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid input: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const input: DayCloseAccessInput = parseResult.data;

    try {
      // SEC-010: Delegate to service for authorization decision
      // SEC-006 & DB-006: Service uses DAL with parameterized, store-scoped queries
      // SEC-017: Service logs all access attempts
      const result = await checkAccess(store.store_id, input);

      // Return full result - service already handles all business logic
      return result;
    } catch (error) {
      // API-003: Log full error server-side, return sanitized message
      log.error('Day close access check failed', {
        storeId: store.store_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Don't leak internal errors
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while checking access. Please try again.'
      );
    }
  },
  {
    requiresAuth: false, // No prior auth required - PIN is the authentication
    description: 'Check day close access with PIN authentication',
  }
);

log.info('Day close handlers registered');
