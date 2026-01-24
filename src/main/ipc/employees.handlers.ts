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
import { usersDAL, UsersDAL, type UserRole, type SafeUser, type User } from '../dal/users.dal';
import { storesDAL } from '../dal/stores.dal';
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
      // SEC-001: PIN will be hashed by DAL
      const user = await usersDAL.create({
        store_id: storeResult.storeId,
        name,
        role: role as UserRole,
        pin,
      });

      // SEC-017: Audit log
      log.info('Employee created', {
        userId: user.user_id,
        name: user.name,
        role: user.role,
        storeId: storeResult.storeId,
        createdBy: getCurrentAuthUser()?.userId,
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

      // SEC-017: Audit log
      log.info('Employee updated', {
        userId,
        changes: { name, role },
        updatedBy: getCurrentAuthUser()?.userId,
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

      // Update PIN (will be hashed by DAL)
      const updatedUser = await usersDAL.update(userId, { pin: newPin });

      if (!updatedUser) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }

      // SEC-017: Audit log (without PIN values)
      log.info('Employee PIN updated', {
        userId,
        updatedBy: getCurrentAuthUser()?.userId,
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

      // SEC-017: Audit log
      log.info('Employee deactivated', {
        userId,
        deactivatedBy: currentUser?.userId,
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

      const success = usersDAL.reactivate(userId);

      if (!success) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Employee not found');
      }

      // SEC-017: Audit log
      log.info('Employee reactivated', {
        userId,
        reactivatedBy: getCurrentAuthUser()?.userId,
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

// Log handler registration
log.info('Employee IPC handlers registered');
