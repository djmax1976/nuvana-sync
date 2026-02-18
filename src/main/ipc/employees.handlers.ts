/**
 * Employee Management IPC Handlers
 *
 * Handles employee CRUD operations from the renderer process.
 * All handlers validate input using Zod schemas per API-001.
 *
 * @module main/ipc/employees.handlers
 * @security API-001: Input validation with Zod schemas
 * @security API-004: Authentication and authorization checks
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 * @security SEC-017: Audit logging for employee changes
 */

import { z } from 'zod';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes,
} from './index';
import { usersDAL, UsersDAL, type UserRole, type SafeUser } from '../dal/users.dal';
import { storesDAL } from '../dal/stores.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import { getCurrentAuthUser, hasMinimumRole } from '../services/auth.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('employees-handlers');

// ============================================================================
// Validation Schemas (API-001)
// ============================================================================

/**
 * PIN format: exactly 4 digits per user requirements
 */
const PinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

/**
 * Employee role (excludes store_manager - managed separately)
 */
const EmployeeRoleSchema = z.enum(['cashier', 'shift_manager']);

/**
 * Create employee request
 */
const CreateEmployeeSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    role: EmployeeRoleSchema,
    pin: PinSchema,
    confirmPin: PinSchema,
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'PINs do not match',
    path: ['confirmPin'],
  });

/**
 * Update employee request
 */
const UpdateEmployeeSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  role: EmployeeRoleSchema.optional(),
});

/**
 * Update PIN request
 */
const UpdatePinSchema = z
  .object({
    userId: z.string().uuid('Invalid user ID format'),
    currentPin: PinSchema,
    newPin: PinSchema,
    confirmPin: PinSchema,
  })
  .refine((data) => data.newPin === data.confirmPin, {
    message: 'New PINs do not match',
    path: ['confirmPin'],
  });

/**
 * Toggle status request
 */
const ToggleStatusSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify that the current user has permission to manage employees
 * @returns Error response if unauthorized, null if authorized
 */
function checkManagerPermission(): ReturnType<typeof createErrorResponse> | null {
  const currentUser = getCurrentAuthUser();
  if (!currentUser) {
    return createErrorResponse(IPCErrorCodes.NOT_AUTHENTICATED, 'Authentication required');
  }

  // Only store managers can manage employees
  if (!hasMinimumRole(currentUser, 'store_manager')) {
    log.warn('Unauthorized employee management attempt', {
      userId: currentUser.userId,
      role: currentUser.role,
    });
    return createErrorResponse(IPCErrorCodes.FORBIDDEN, 'Only store managers can manage employees');
  }

  return null;
}

/**
 * Get the configured store ID
 * @returns Store ID or error response
 */
function getStoreIdOrError():
  | { storeId: string }
  | { error: ReturnType<typeof createErrorResponse> } {
  const store = storesDAL.getConfiguredStore();
  if (!store) {
    return { error: createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured') };
  }
  return { storeId: store.store_id };
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * List all employees for the current store
 * Requires store manager role
 *
 * Channel: employees:list
 */
registerHandler(
  'employees:list',
  async () => {
    // Check authorization
    const authError = checkManagerPermission();
    if (authError) return authError;

    // Get store ID
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // DB-006: Store-scoped query - get all users (active and inactive)
      const result = usersDAL.findByStore(storeResult.storeId, { limit: 1000 });
      const allUsers = result.data;

      // SEC-001: Remove sensitive PIN data
      const safeUsers: SafeUser[] = allUsers.map((user) => UsersDAL.toSafeUser(user));

      log.info('Employee list retrieved', {
        storeId: storeResult.storeId,
        count: safeUsers.length,
      });

      return createSuccessResponse({
        employees: safeUsers,
        total: safeUsers.length,
      });
    } catch (error) {
      log.error('Failed to list employees', { error });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to retrieve employees');
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'List all employees for the store',
  }
);

/**
 * List active employees for shift selection
 *
 * This handler returns only active employees and does NOT require authentication.
 * Used by ShiftStartDialog for manual shift start - users select themselves from
 * the list and then authenticate with their PIN.
 *
 * SEC-001: Returns only active employees (no PIN data - only names and roles)
 * DB-006: Store-scoped query for tenant isolation
 *
 * Channel: employees:listActive
 */
registerHandler(
  'employees:listActive',
  async () => {
    // Get store ID from settings (no auth required)
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // DB-006: Store-scoped query - get only active users
      const result = usersDAL.findByStore(storeResult.storeId, { limit: 1000 });
      const activeUsers = result.data.filter((user) => user.active === 1);

      // SEC-001: Remove sensitive PIN data
      const safeUsers: SafeUser[] = activeUsers.map((user) => UsersDAL.toSafeUser(user));

      log.info('Active employee list retrieved for shift selection', {
        storeId: storeResult.storeId,
        count: safeUsers.length,
      });

      return createSuccessResponse({
        employees: safeUsers,
        total: safeUsers.length,
      });
    } catch (error) {
      log.error('Failed to list active employees', { error });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to retrieve employees');
    }
  },
  {
    requiresAuth: false, // No auth required - users authenticate via PIN entry
    description: 'List active employees for shift selection',
  }
);

/**
 * Create a new employee
 * Requires store manager role
 *
 * Channel: employees:create
 */
registerHandler(
  'employees:create',
  async (_event, input: unknown) => {
    // Check authorization
    const authError = checkManagerPermission();
    if (authError) return authError;

    // API-001: Validate input
    const parseResult = CreateEmployeeSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { name, role, pin } = parseResult.data;

    // Get store ID
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // API-001: Business rule validation - PIN must be unique within the store
      // SEC-001: Uses bcrypt comparison (timing-safe)
      // DB-006: Scoped to configured store for tenant isolation
      const existingUserWithPin = await usersDAL.isPinInUse(storeResult.storeId, pin);
      if (existingUserWithPin) {
        log.warn('PIN uniqueness violation on create', {
          storeId: storeResult.storeId,
          existingUserId: existingUserWithPin.user_id,
          attemptedBy: getCurrentAuthUser()?.userId,
        });
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'This PIN is already in use by another employee. Please choose a different PIN.'
        );
      }

      // SEC-001: PIN will be hashed by DAL
      const user = await usersDAL.create({
        store_id: storeResult.storeId,
        name,
        role: role as UserRole,
        pin,
      });

      // Enqueue sync item for cloud push
      // SEC-001: Payload excludes pin_hash - never sync PIN data
      syncQueueDAL.enqueue({
        store_id: storeResult.storeId,
        entity_type: 'employee',
        entity_id: user.user_id,
        operation: 'CREATE',
        payload: {
          user_id: user.user_id,
          store_id: user.store_id,
          role: user.role,
          name: user.name,
          active: user.active === 1,
        },
      });

      // SEC-017: Audit log
      log.info('Employee created', {
        userId: user.user_id,
        name: user.name,
        role: user.role,
        storeId: storeResult.storeId,
        createdBy: getCurrentAuthUser()?.userId,
        syncEnqueued: true,
      });

      return createSuccessResponse({
        employee: UsersDAL.toSafeUser(user),
      });
    } catch (error) {
      log.error('Failed to create employee', { error, name, role });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to create employee');
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'Create a new employee',
  }
);

/**
 * Update an existing employee
 * Requires store manager role
 *
 * Channel: employees:update
 */
registerHandler(
  'employees:update',
  async (_event, input: unknown) => {
    // Check authorization
    const authError = checkManagerPermission();
    if (authError) return authError;

    // API-001: Validate input
    const parseResult = UpdateEmployeeSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { userId, name, role } = parseResult.data;

    // Get store ID for tenant isolation check
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // DB-006: Verify user belongs to this store
      const existingUser = usersDAL.findById(userId);
      if (!existingUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }
      if (existingUser.store_id !== storeResult.storeId) {
        log.warn('Cross-store employee access attempt', {
          requestedUserId: userId,
          userStoreId: existingUser.store_id,
          currentStoreId: storeResult.storeId,
        });
        return createErrorResponse(IPCErrorCodes.FORBIDDEN, 'Access denied');
      }

      // Prevent demoting store managers via this endpoint
      if (existingUser.role === 'store_manager') {
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Store manager accounts cannot be modified here'
        );
      }

      // Update user
      const updatedUser = await usersDAL.update(userId, {
        ...(name && { name }),
        ...(role && { role: role as UserRole }),
      });

      if (!updatedUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }

      // Enqueue sync item for cloud push
      // SEC-001: Payload excludes pin_hash - never sync PIN data
      syncQueueDAL.enqueue({
        store_id: storeResult.storeId,
        entity_type: 'employee',
        entity_id: updatedUser.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: updatedUser.user_id,
          store_id: updatedUser.store_id,
          role: updatedUser.role,
          name: updatedUser.name,
          active: updatedUser.active === 1,
        },
      });

      // SEC-017: Audit log
      log.info('Employee updated', {
        userId,
        changes: { name, role },
        updatedBy: getCurrentAuthUser()?.userId,
        syncEnqueued: true,
      });

      return createSuccessResponse({
        employee: UsersDAL.toSafeUser(updatedUser),
      });
    } catch (error) {
      log.error('Failed to update employee', { error, userId });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to update employee');
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'Update employee details',
  }
);

/**
 * Update an employee's PIN
 * Requires current PIN verification
 *
 * Channel: employees:updatePin
 */
registerHandler(
  'employees:updatePin',
  async (_event, input: unknown) => {
    // Check authorization
    const authError = checkManagerPermission();
    if (authError) return authError;

    // API-001: Validate input
    const parseResult = UpdatePinSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { userId, currentPin, newPin } = parseResult.data;

    // Get store ID for tenant isolation check
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // DB-006: Verify user belongs to this store
      const existingUser = usersDAL.findById(userId);
      if (!existingUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }
      if (existingUser.store_id !== storeResult.storeId) {
        log.warn('Cross-store PIN change attempt', {
          requestedUserId: userId,
          userStoreId: existingUser.store_id,
          currentStoreId: storeResult.storeId,
        });
        return createErrorResponse(IPCErrorCodes.FORBIDDEN, 'Access denied');
      }

      // SEC-001: Verify current PIN
      const isCurrentPinValid = await usersDAL.verifyPin(userId, currentPin);
      if (!isCurrentPinValid) {
        log.warn('Invalid current PIN during PIN change', { userId });
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Current PIN is incorrect');
      }

      // API-001: Business rule validation - New PIN must be unique within the store
      // SEC-001: Uses bcrypt comparison (timing-safe)
      // DB-006: Scoped to configured store for tenant isolation
      // Note: Exclude current user since they may be keeping the same PIN
      const existingUserWithPin = await usersDAL.isPinInUse(
        storeResult.storeId,
        newPin,
        userId // Exclude the user being updated
      );
      if (existingUserWithPin) {
        log.warn('PIN uniqueness violation on update', {
          storeId: storeResult.storeId,
          userId,
          existingUserId: existingUserWithPin.user_id,
          attemptedBy: getCurrentAuthUser()?.userId,
        });
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'This PIN is already in use by another employee. Please choose a different PIN.'
        );
      }

      // Update PIN (will be hashed by DAL)
      const updatedUser = await usersDAL.update(userId, { pin: newPin });

      if (!updatedUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }

      // Enqueue sync item for cloud push
      // SEC-001: Payload EXCLUDES pin_hash - PIN changes are local-only
      // Cloud does not receive PIN data for security reasons
      syncQueueDAL.enqueue({
        store_id: storeResult.storeId,
        entity_type: 'employee',
        entity_id: updatedUser.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: updatedUser.user_id,
          store_id: updatedUser.store_id,
          role: updatedUser.role,
          name: updatedUser.name,
          active: updatedUser.active === 1,
        },
      });

      // SEC-017: Audit log (without PIN values)
      log.info('Employee PIN updated', {
        userId,
        updatedBy: getCurrentAuthUser()?.userId,
        syncEnqueued: true,
      });

      return createSuccessResponse({
        success: true,
        message: 'PIN updated successfully',
      });
    } catch (error) {
      log.error('Failed to update employee PIN', { error, userId });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to update PIN');
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'Update employee PIN',
  }
);

/**
 * Deactivate an employee
 * Requires store manager role
 *
 * Channel: employees:deactivate
 */
registerHandler(
  'employees:deactivate',
  async (_event, input: unknown) => {
    // Check authorization
    const authError = checkManagerPermission();
    if (authError) return authError;

    // API-001: Validate input
    const parseResult = ToggleStatusSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { userId } = parseResult.data;

    // Get store ID for tenant isolation check
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // DB-006: Verify user belongs to this store
      const existingUser = usersDAL.findById(userId);
      if (!existingUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }
      if (existingUser.store_id !== storeResult.storeId) {
        return createErrorResponse(IPCErrorCodes.FORBIDDEN, 'Access denied');
      }

      // Prevent deactivating store managers
      if (existingUser.role === 'store_manager') {
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Store manager accounts cannot be deactivated'
        );
      }

      // Prevent self-deactivation
      const currentUser = getCurrentAuthUser();
      if (currentUser && currentUser.userId === userId) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Cannot deactivate your own account'
        );
      }

      const success = usersDAL.deactivate(userId);

      if (!success) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }

      // Enqueue sync item for cloud push
      // SEC-001: Payload excludes pin_hash - never sync PIN data
      syncQueueDAL.enqueue({
        store_id: storeResult.storeId,
        entity_type: 'employee',
        entity_id: existingUser.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: existingUser.user_id,
          store_id: existingUser.store_id,
          role: existingUser.role,
          name: existingUser.name,
          active: false, // Deactivated
        },
      });

      // SEC-017: Audit log
      log.info('Employee deactivated', {
        userId,
        deactivatedBy: currentUser?.userId,
        syncEnqueued: true,
      });

      return createSuccessResponse({
        success: true,
        message: 'Employee deactivated successfully',
      });
    } catch (error) {
      log.error('Failed to deactivate employee', { error, userId });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to deactivate employee');
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'Deactivate an employee',
  }
);

/**
 * Reactivate an employee
 * Requires store manager role
 *
 * Channel: employees:reactivate
 */
registerHandler(
  'employees:reactivate',
  async (_event, input: unknown) => {
    // Check authorization
    const authError = checkManagerPermission();
    if (authError) return authError;

    // API-001: Validate input
    const parseResult = ToggleStatusSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { userId } = parseResult.data;

    // Get store ID for tenant isolation check
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // DB-006: Verify user belongs to this store
      const existingUser = usersDAL.findById(userId);
      if (!existingUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }
      if (existingUser.store_id !== storeResult.storeId) {
        return createErrorResponse(IPCErrorCodes.FORBIDDEN, 'Access denied');
      }

      // NOTE: PIN uniqueness cannot be verified on reactivation because:
      // 1. PINs are bcrypt-hashed with random salts (SEC-001 compliant)
      // 2. We don't have the plaintext PIN to check against other users
      // 3. Different bcrypt hashes of the same PIN cannot be compared directly
      //
      // Risk: If user A (PIN 1234) was deactivated, then user B was given PIN 1234,
      // reactivating user A would create a PIN collision.
      //
      // Mitigation: The manager should reset the employee's PIN after reactivation
      // if there's any concern about conflicts. The isPinInUse check on PIN updates
      // will catch this when the PIN is changed.
      //
      // Future enhancement: Add a deterministic hash (HMAC-SHA256) column for
      // uniqueness checking that can be compared without the plaintext PIN.

      const success = usersDAL.reactivate(userId);

      if (!success) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }

      // Enqueue sync item for cloud push
      // SEC-001: Payload excludes pin_hash - never sync PIN data
      syncQueueDAL.enqueue({
        store_id: storeResult.storeId,
        entity_type: 'employee',
        entity_id: existingUser.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: existingUser.user_id,
          store_id: existingUser.store_id,
          role: existingUser.role,
          name: existingUser.name,
          active: true, // Reactivated
        },
      });

      // SEC-017: Audit log with reactivation warning for PIN review
      log.info('Employee reactivated', {
        userId,
        reactivatedBy: getCurrentAuthUser()?.userId,
        warning: 'Manager should verify PIN uniqueness or reset PIN if needed',
        syncEnqueued: true,
      });

      return createSuccessResponse({
        success: true,
        message: 'Employee reactivated successfully',
      });
    } catch (error) {
      log.error('Failed to reactivate employee', { error, userId });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to reactivate employee');
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'Reactivate an employee',
  }
);

// ============================================================================
// Cashiers List Handler (Task 1.5 - Day Close Page)
// ============================================================================

/**
 * Cashier info for dropdown/display
 */
interface CashierInfo {
  /** User ID (UUID) */
  cashier_id: string;
  /** Display name */
  name: string;
  /** Role */
  role: string;
}

/**
 * Response for cashiers list
 */
interface CashiersListResponse {
  /** Array of active cashiers */
  cashiers: CashierInfo[];
  /** Total count */
  total: number;
}

/**
 * List active cashiers for the current store
 *
 * Used by DayClosePage for cashier name resolution and dropdowns.
 * Returns only active users (is_active = 1).
 *
 * Performance characteristics:
 * - Single query to users table with indexed columns (store_id, active)
 * - O(1) via index lookup
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped for tenant isolation
 * @security SEC-001: Returns only safe user data (no PIN hash)
 *
 * Channel: cashiers:list
 */
registerHandler<CashiersListResponse | ReturnType<typeof createErrorResponse>>(
  'cashiers:list',
  async () => {
    // DB-006: Get configured store for tenant isolation
    const storeResult = getStoreIdOrError();
    if ('error' in storeResult) return storeResult.error;

    try {
      // SEC-006: Parameterized query via DAL
      // DB-006: Store-scoped query
      const result = usersDAL.findByStore(storeResult.storeId, { limit: 1000 });

      // Filter to active users only
      const activeUsers = result.data.filter((user) => user.active === 1);

      // Map to cashier info (SEC-001: exclude pin_hash)
      const cashiers: CashierInfo[] = activeUsers.map((user) => ({
        cashier_id: user.user_id,
        name: user.name,
        role: user.role,
      }));

      log.debug('Cashiers list retrieved', {
        storeId: storeResult.storeId,
        count: cashiers.length,
      });

      return {
        cashiers,
        total: cashiers.length,
      };
    } catch (error) {
      log.error('Failed to list cashiers', { error });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to retrieve cashiers');
    }
  },
  {
    requiresAuth: false, // No auth required - used for display purposes
    description: 'List active cashiers for the store',
  }
);

// Log handler registration
log.info('Employee IPC handlers registered');
