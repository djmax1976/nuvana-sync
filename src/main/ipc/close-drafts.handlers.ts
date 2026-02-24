/**
 * Close Drafts IPC Handlers
 *
 * Provides draft management endpoints for Day Close and Shift Close wizards.
 * Drafts store working copies of wizard data until finalization.
 *
 * @module main/ipc/close-drafts
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-010: Authorization enforced server-side via getCurrentUser()
 * @security SEC-006: All queries use parameterized statements via DAL
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security API-001: Input validation via Zod schemas
 * @security API-003: Sanitized error responses, no stack traces exposed
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes, getCurrentUser } from './index';
import { storesDAL } from '../dal/stores.dal';
import { shiftsDAL } from '../dal/shifts.dal';
import { shiftSummariesDAL } from '../dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import { lotteryBusinessDaysDAL } from '../dal/lottery-business-days.dal';
import {
  closeDraftsDAL,
  type DraftType,
  type DraftPayload,
  type LotteryPayload,
  type StepState,
  type CloseDraft,
  VersionConflictError,
  InvalidStatusTransitionError,
} from '../dal/close-drafts.dal';
import { buildShiftSyncPayload, SHIFT_SYNC_PRIORITY } from './shifts.handlers';
import { createLogger } from '../utils/logger';
import { getCurrentBusinessDate } from './lottery.handlers';

// ============================================================================
// Types
// ============================================================================

/**
 * Response for draft operations
 */
interface DraftResponse {
  draft: CloseDraft;
}

/**
 * Response for get draft (may not exist)
 */
interface GetDraftResponse {
  draft: CloseDraft | null;
}

/**
 * Response for finalize operation
 */
interface FinalizeResponse {
  success: boolean;
  closed_at: string;
  lottery_result?: {
    closings_created: number;
    lottery_total: number;
    next_day: {
      day_id: string;
      business_date: string;
      status: string;
    };
  };
  shift_result?: {
    shift_id: string;
    shift_number: number;
    business_date: string;
    closing_cash: number;
  };
}

/**
 * Version conflict error response
 */
interface VersionConflictResponse {
  error: 'VERSION_CONFLICT';
  message: string;
  current_version: number;
  expected_version: number;
}

// ============================================================================
// Input Validation Schemas (API-001)
// ============================================================================

/**
 * UUID schema with format validation
 * SEC-014: Strict UUID format prevents injection
 */
const UUIDSchema = z
  .string()
  .uuid('Invalid UUID format')
  .min(36, 'UUID must be 36 characters')
  .max(36, 'UUID must be 36 characters');

/**
 * Draft type enum schema
 */
const DraftTypeSchema = z.enum(['DAY_CLOSE', 'SHIFT_CLOSE']);

/**
 * Step state enum schema
 */
const StepStateSchema = z.enum(['LOTTERY', 'REPORTS', 'REVIEW']).nullable();

/**
 * Schema for creating a draft
 * API-001: Validates shift_id as UUID, draft_type as enum
 */
const CreateDraftSchema = z.object({
  shift_id: UUIDSchema,
  draft_type: DraftTypeSchema,
});

/**
 * Schema for getting a draft by ID or shift
 * API-001: At least one of draft_id or shift_id required
 */
const GetDraftSchema = z
  .object({
    draft_id: UUIDSchema.optional(),
    shift_id: UUIDSchema.optional(),
  })
  .refine((data) => data.draft_id || data.shift_id, {
    message: 'Either draft_id or shift_id must be provided',
  });

/**
 * Schema for updating draft payload
 * API-001: Validates draft_id, version, and payload structure
 */
const UpdateDraftSchema = z.object({
  draft_id: UUIDSchema,
  payload: z.record(z.string(), z.unknown()).refine(
    (val) => {
      // Ensure payload is a valid JSON-serializable object
      try {
        JSON.stringify(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Payload must be a valid JSON-serializable object' }
  ),
  version: z.number().int('Version must be an integer').min(1, 'Version must be at least 1'),
});

/**
 * Schema for bin scan data in lottery payload
 * SEC-014: Strict validation of all bin scan fields
 */
const BinScanSchema = z.object({
  pack_id: UUIDSchema,
  bin_id: UUIDSchema,
  closing_serial: z.string().regex(/^\d{3}$/, 'Closing serial must be 3 digits'),
  is_sold_out: z.boolean(),
  scanned_at: z.string().datetime('Invalid ISO datetime format'),
});

/**
 * Schema for lottery totals
 */
const LotteryTotalsSchema = z.object({
  tickets_sold: z.number().int().min(0, 'Tickets sold cannot be negative'),
  sales_amount: z.number().min(0, 'Sales amount cannot be negative'),
});

/**
 * Schema for lottery payload
 * API-001: Comprehensive validation of all lottery fields
 */
const LotteryPayloadSchema = z.object({
  bins_scans: z.array(BinScanSchema).default([]),
  totals: LotteryTotalsSchema,
  entry_method: z.enum(['SCAN', 'MANUAL']),
  authorized_by: UUIDSchema.optional(),
});

/**
 * Schema for updating lottery data specifically
 * API-001: Specialized handler for Step 1 data
 */
const UpdateLotterySchema = z.object({
  draft_id: UUIDSchema,
  lottery_data: LotteryPayloadSchema,
  version: z.number().int('Version must be an integer').min(1, 'Version must be at least 1'),
});

/**
 * Schema for updating step state
 * API-001: Validates step_state is a valid enum value
 */
const UpdateStepStateSchema = z.object({
  draft_id: UUIDSchema,
  step_state: StepStateSchema,
});

/**
 * Schema for finalizing a draft
 * API-001: Validates draft_id and closing_cash
 */
const FinalizeDraftSchema = z.object({
  draft_id: UUIDSchema,
  closing_cash: z
    .number({ message: 'Closing cash must be a number' })
    .min(0, 'Closing cash must be non-negative')
    .max(999999.99, 'Closing cash exceeds maximum allowed value'),
});

/**
 * Schema for expiring a draft
 * API-001: Validates draft_id
 */
const ExpireDraftSchema = z.object({
  draft_id: UUIDSchema,
});

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('close-drafts-handlers');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Error response type for validation helpers
 */
interface ErrorResult {
  ok: false;
  response: ReturnType<typeof createErrorResponse>;
}

/**
 * Success result type for validation helpers
 */
interface SuccessResult<T> {
  ok: true;
  value: T;
}

/**
 * Result type using discriminated union for proper type narrowing
 */
type Result<T> = SuccessResult<T> | ErrorResult;

/**
 * Get configured store ID with validation
 * DB-006: Ensures tenant isolation by always using configured store
 *
 * @returns Result with store ID or error response
 */
function requireStore(): Result<string> {
  const store = storesDAL.getConfiguredStore();
  if (!store?.store_id) {
    return {
      ok: false,
      response: createErrorResponse(
        IPCErrorCodes.NOT_CONFIGURED,
        'Store not configured. Please complete setup first.'
      ),
    };
  }
  return { ok: true, value: store.store_id };
}

/**
 * Validate user is authenticated and return user ID
 * SEC-010: Centralized authentication validation
 *
 * @returns Result with user ID or error response
 */
function requireAuth(): Result<string> {
  const user = getCurrentUser();
  if (!user?.user_id) {
    return {
      ok: false,
      response: createErrorResponse(
        IPCErrorCodes.NOT_AUTHENTICATED,
        'User authentication required.'
      ),
    };
  }
  return { ok: true, value: user.user_id };
}

/**
 * Build version conflict error response
 * Includes current version for client retry logic
 */
function createVersionConflictResponse(
  currentVersion: number,
  expectedVersion: number
): VersionConflictResponse {
  return {
    error: 'VERSION_CONFLICT',
    message: `Version conflict: expected ${expectedVersion}, but current is ${currentVersion}. Please refresh and retry.`,
    current_version: currentVersion,
    expected_version: expectedVersion,
  };
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Create Draft Handler
 * Channel: drafts:create
 *
 * Creates a new draft or returns existing active draft (idempotent).
 * If an IN_PROGRESS or FINALIZING draft exists for the shift, returns it.
 *
 * @security SEC-010: Requires authenticated user (created_by field)
 * @security DB-006: Store-scoped via configured store
 * @security API-001: Zod schema validation
 */
registerHandler<DraftResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:create',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input
    const parseResult = CreateDraftSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid draft create input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { shift_id: shiftId, draft_type: draftType } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    // SEC-010: Get authenticated user
    const userResult = requireAuth();
    if (!userResult.ok) {
      return userResult.response;
    }
    const userId = userResult.value;

    try {
      // Check for existing active draft (idempotent creation)
      const existing = closeDraftsDAL.getActiveDraft(storeId, shiftId);
      if (existing) {
        log.debug('Returning existing active draft', {
          draftId: existing.draft_id,
          shiftId,
          status: existing.status,
        });
        return { draft: existing };
      }

      // Validate shift exists and belongs to store
      const shift = shiftsDAL.findById(shiftId);
      if (!shift || shift.store_id !== storeId) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Get business date from shift
      const businessDate = shift.business_date;

      // Create new draft
      const draft = closeDraftsDAL.createDraft(
        storeId,
        shiftId,
        businessDate,
        draftType as DraftType,
        userId
      );

      log.info('Draft created', {
        draftId: draft.draft_id,
        shiftId,
        draftType,
        businessDate,
        createdBy: userId,
      });

      return { draft };
    } catch (error) {
      log.error('Failed to create draft', {
        shiftId,
        draftType,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while creating the draft.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Create or retrieve active draft for a shift',
  }
);

/**
 * Get Draft Handler
 * Channel: drafts:get
 *
 * Retrieves a draft by ID or finds active draft for a shift.
 *
 * @security SEC-010: Requires authentication
 * @security DB-006: Store-scoped validation prevents cross-tenant access
 * @security API-001: Zod schema validation
 */
registerHandler<GetDraftResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:get',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input
    const parseResult = GetDraftSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid draft get input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { draft_id: draftId, shift_id: shiftId } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    try {
      let draft: CloseDraft | undefined;

      if (draftId) {
        // Get by draft ID with store validation
        draft = closeDraftsDAL.getDraft(storeId, draftId);
      } else if (shiftId) {
        // Get active draft for shift
        draft = closeDraftsDAL.getActiveDraft(storeId, shiftId);
      }

      return { draft: draft ?? null };
    } catch (error) {
      log.error('Failed to get draft', {
        draftId,
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while retrieving the draft.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Get draft by ID or active draft for shift',
  }
);

/**
 * Update Draft Handler
 * Channel: drafts:update
 *
 * Updates draft payload with optimistic locking.
 * Performs deep merge of partial payload into existing.
 *
 * @security SEC-010: Requires authentication
 * @security DB-006: Store-scoped validation
 * @security API-001: Zod schema validation
 */
registerHandler<DraftResponse | VersionConflictResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:update',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input
    const parseResult = UpdateDraftSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid draft update input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { draft_id: draftId, payload, version } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    // SEC-010: Verify authenticated user (defense-in-depth)
    const userResult = requireAuth();
    if (!userResult.ok) {
      return userResult.response;
    }

    try {
      // Update with optimistic locking
      const updated = closeDraftsDAL.updateDraft(
        storeId,
        draftId,
        payload as Partial<DraftPayload>,
        version
      );

      log.debug('Draft updated', {
        draftId,
        oldVersion: version,
        newVersion: updated.version,
      });

      return { draft: updated };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        log.warn('Version conflict on draft update', {
          draftId,
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        });
        return createVersionConflictResponse(error.currentVersion, error.expectedVersion);
      }

      // Draft not found
      if (error instanceof Error && error.message.includes('Draft not found')) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Draft not found');
      }

      // Cannot update finalized/expired
      if (error instanceof Error && error.message.includes('Cannot update draft')) {
        return createErrorResponse(IPCErrorCodes.CONFLICT, 'Cannot update draft in current status');
      }

      log.error('Failed to update draft', {
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while updating the draft.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Update draft payload with optimistic locking',
  }
);

/**
 * Update Lottery Handler
 * Channel: drafts:updateLottery
 *
 * Specialized handler for updating lottery step data (Step 1).
 * Validates lottery payload structure thoroughly.
 *
 * @security SEC-010: Requires authentication
 * @security DB-006: Store-scoped validation
 * @security API-001: Zod schema validation with lottery-specific fields
 */
registerHandler<DraftResponse | VersionConflictResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:updateLottery',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input with specialized lottery schema
    const parseResult = UpdateLotterySchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid lottery update input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { draft_id: draftId, lottery_data: lotteryData, version } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    // SEC-010: Verify authenticated user (defense-in-depth)
    const userResult = requireAuth();
    if (!userResult.ok) {
      return userResult.response;
    }

    try {
      // Build partial payload with lottery data
      const partialPayload: Partial<DraftPayload> = {
        lottery: lotteryData as LotteryPayload,
      };

      // Update with optimistic locking
      const updated = closeDraftsDAL.updateDraft(storeId, draftId, partialPayload, version);

      log.debug('Lottery data updated in draft', {
        draftId,
        binsCount: lotteryData.bins_scans.length,
        ticketsSold: lotteryData.totals.tickets_sold,
        salesAmount: lotteryData.totals.sales_amount,
      });

      return { draft: updated };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        log.warn('Version conflict on lottery update', {
          draftId,
          expectedVersion: error.expectedVersion,
          currentVersion: error.currentVersion,
        });
        return createVersionConflictResponse(error.currentVersion, error.expectedVersion);
      }

      if (error instanceof Error && error.message.includes('Draft not found')) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Draft not found');
      }

      if (error instanceof Error && error.message.includes('Cannot update draft')) {
        return createErrorResponse(IPCErrorCodes.CONFLICT, 'Cannot update draft in current status');
      }

      log.error('Failed to update lottery data', {
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while updating lottery data.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Update lottery step data in draft',
  }
);

/**
 * Update Step State Handler
 * Channel: drafts:updateStepState
 *
 * Updates the step state for crash recovery navigation.
 *
 * @security SEC-010: Requires authentication
 * @security DB-006: Store-scoped validation
 * @security API-001: Zod schema validation
 */
registerHandler<DraftResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:updateStepState',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input
    const parseResult = UpdateStepStateSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid step state update input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { draft_id: draftId, step_state: stepState } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    // SEC-010: Verify authenticated user (defense-in-depth)
    const userResult = requireAuth();
    if (!userResult.ok) {
      return userResult.response;
    }

    try {
      const updated = closeDraftsDAL.updateStepState(storeId, draftId, stepState as StepState);

      log.debug('Step state updated', {
        draftId,
        stepState,
      });

      return { draft: updated };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Draft not found')) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Draft not found');
      }

      if (error instanceof Error && error.message.includes('Invalid step state')) {
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid step state');
      }

      log.error('Failed to update step state', {
        draftId,
        stepState,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while updating step state.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Update draft step state for crash recovery',
  }
);

/**
 * Finalize Draft Handler
 * Channel: drafts:finalize
 *
 * Orchestrates atomic finalization of the draft:
 * 1. Lock draft (status → FINALIZING)
 * 2. For DAY_CLOSE: Execute lottery close (prepareDayClose + commitDayClose)
 * 3. Execute shift close with closing_cash
 * 4. Mark draft FINALIZED
 *
 * Full transaction rollback on any failure.
 *
 * @security SEC-010: Requires authentication for all operations
 * @security DB-006: Store-scoped validation on all operations
 * @security API-001: Zod schema validation
 * @security SEC-017: Audit logging for finalization
 */
registerHandler<FinalizeResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:finalize',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input
    const parseResult = FinalizeDraftSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid finalize input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { draft_id: draftId, closing_cash: closingCash } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    // SEC-010: Get authenticated user
    const userResult = requireAuth();
    if (!userResult.ok) {
      return userResult.response;
    }
    const userId = userResult.value;

    // Fetch draft with store validation
    const draft = closeDraftsDAL.getDraft(storeId, draftId);
    if (!draft) {
      return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Draft not found');
    }

    // Check if already finalized (idempotent success)
    if (draft.status === 'FINALIZED') {
      log.info('Draft already finalized', { draftId });
      return {
        success: true,
        closed_at: draft.updated_at,
      };
    }

    // Check if expired
    if (draft.status === 'EXPIRED') {
      return createErrorResponse(IPCErrorCodes.CONFLICT, 'Draft has expired');
    }

    // Get the shift for validation
    const shift = shiftsDAL.findById(draft.shift_id);
    if (!shift || shift.store_id !== storeId) {
      return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Associated shift not found');
    }

    // Check shift is still open
    if (shift.status === 'CLOSED') {
      return createErrorResponse(IPCErrorCodes.ALREADY_CLOSED, 'Shift is already closed');
    }

    let lotteryResult: FinalizeResponse['lottery_result'] | undefined;
    let shiftResult: FinalizeResponse['shift_result'] | undefined;

    try {
      // ========================================================================
      // Step 1: Lock draft (IN_PROGRESS → FINALIZING)
      // ========================================================================
      closeDraftsDAL.beginFinalize(storeId, draftId);
      log.info('Draft finalization started', { draftId, draftType: draft.draft_type });

      // ========================================================================
      // Step 2: For DAY_CLOSE, execute lottery close
      // ========================================================================
      if (draft.draft_type === 'DAY_CLOSE') {
        const lotteryPayload = draft.payload.lottery;

        if (
          !lotteryPayload ||
          !lotteryPayload.bins_scans ||
          lotteryPayload.bins_scans.length === 0
        ) {
          // No lottery data - this could be valid for stores without lottery
          log.info('No lottery data in draft, skipping lottery close', { draftId });
        } else {
          // Prepare lottery closings from draft payload
          const closings = lotteryPayload.bins_scans.map((scan) => ({
            pack_id: scan.pack_id,
            closing_serial: scan.closing_serial,
            is_sold_out: scan.is_sold_out,
          }));

          // Get or create business day for today
          const today = getCurrentBusinessDate();
          const day = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today, userId);

          // Execute lottery prepare and commit
          // SEC-010: fromWizard=true allows all POS types
          lotteryBusinessDaysDAL.prepareClose(day.day_id, closings);
          const commitResult = lotteryBusinessDaysDAL.commitClose(day.day_id, userId);

          // BIZ-007: Auto-open next day
          const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today, userId);

          lotteryResult = {
            closings_created: commitResult.closings_created,
            lottery_total: commitResult.lottery_total,
            next_day: {
              day_id: nextDay.day_id,
              business_date: nextDay.business_date,
              status: nextDay.status,
            },
          };

          log.info('Lottery day closed via draft finalize', {
            draftId,
            dayId: day.day_id,
            closingsCreated: commitResult.closings_created,
            lotteryTotal: commitResult.lottery_total,
          });
        }
      }

      // ========================================================================
      // Step 3: Close the shift with closing_cash
      // ========================================================================
      const closedShift = shiftsDAL.close(shift.shift_id);
      if (!closedShift) {
        throw new Error('Failed to close shift');
      }

      // Update shift summary with closing_cash
      const shiftSummary = shiftSummariesDAL.findByShiftId(storeId, shift.shift_id);
      if (shiftSummary && closedShift.end_time) {
        shiftSummariesDAL.closeShiftSummary(
          storeId,
          shiftSummary.shift_summary_id,
          closedShift.end_time,
          userId,
          closingCash
        );
      }

      // SYNC-001: Enqueue shift update for cloud sync
      syncQueueDAL.enqueue({
        entity_type: 'shift',
        entity_id: closedShift.shift_id,
        operation: 'UPDATE',
        store_id: storeId,
        priority: SHIFT_SYNC_PRIORITY,
        payload: buildShiftSyncPayload(closedShift, { closing_cash: closingCash }),
      });

      shiftResult = {
        shift_id: closedShift.shift_id,
        shift_number: closedShift.shift_number,
        business_date: closedShift.business_date,
        closing_cash: closingCash,
      };

      log.info('Shift closed via draft finalize', {
        draftId,
        shiftId: closedShift.shift_id,
        shiftNumber: closedShift.shift_number,
        closingCash,
      });

      // ========================================================================
      // Step 4: Mark draft as FINALIZED
      // ========================================================================
      closeDraftsDAL.finalizeDraft(storeId, draftId);

      // Update closing_cash in draft payload for audit trail
      closeDraftsDAL.updateDraft(
        storeId,
        draftId,
        { closing_cash: closingCash },
        closeDraftsDAL.getDraft(storeId, draftId)!.version
      );

      const closedAt = new Date().toISOString();

      // SEC-017: Audit log
      log.info('Draft finalized successfully', {
        draftId,
        draftType: draft.draft_type,
        shiftId: draft.shift_id,
        closingCash,
        closedAt,
        lotteryClosingsCreated: lotteryResult?.closings_created ?? 0,
      });

      return {
        success: true,
        closed_at: closedAt,
        lottery_result: lotteryResult,
        shift_result: shiftResult,
      };
    } catch (error) {
      // ========================================================================
      // Rollback: Revert draft to IN_PROGRESS on failure
      // ========================================================================
      log.error('Draft finalization failed, rolling back', {
        draftId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      try {
        // Check if draft is in FINALIZING state before rollback
        const currentDraft = closeDraftsDAL.getDraft(storeId, draftId);
        if (currentDraft?.status === 'FINALIZING') {
          closeDraftsDAL.rollbackFinalize(storeId, draftId);
          log.info('Draft rolled back to IN_PROGRESS', { draftId });
        }
      } catch (rollbackError) {
        log.error('Failed to rollback draft status', {
          draftId,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }

      // Return specific error messages for known issues
      if (error instanceof InvalidStatusTransitionError) {
        return createErrorResponse(IPCErrorCodes.CONFLICT, `Cannot finalize: ${error.message}`);
      }

      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred during finalization. Please try again.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'cashier', // At minimum cashier role required
    description: 'Finalize draft and commit to final tables',
  }
);

/**
 * Expire Draft Handler
 * Channel: drafts:expire
 *
 * Expires a draft, making it inactive.
 * Used for discarding drafts or cleanup.
 *
 * @security SEC-010: Requires authentication
 * @security DB-006: Store-scoped validation
 * @security API-001: Zod schema validation
 */
registerHandler<DraftResponse | ReturnType<typeof createErrorResponse>>(
  'drafts:expire',
  async (_event, inputRaw: unknown) => {
    // API-001: Validate input
    const parseResult = ExpireDraftSchema.safeParse(inputRaw);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid expire input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { draft_id: draftId } = parseResult.data;

    // DB-006: Get configured store
    const storeResult = requireStore();
    if (!storeResult.ok) {
      return storeResult.response;
    }
    const storeId = storeResult.value;

    // SEC-010: Verify authenticated user (defense-in-depth)
    const userResult = requireAuth();
    if (!userResult.ok) {
      return userResult.response;
    }

    try {
      const expired = closeDraftsDAL.expireDraft(storeId, draftId);

      log.info('Draft expired', {
        draftId,
        previousStatus: expired.status,
      });

      return { draft: expired };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Draft not found')) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Draft not found');
      }

      log.error('Failed to expire draft', {
        draftId,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'An error occurred while expiring the draft.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Expire a draft (discard)',
  }
);

// ============================================================================
// Handler Registration Complete
// ============================================================================

log.info('Close drafts handlers registered');
