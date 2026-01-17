/**
 * Employee Query Hooks
 *
 * TanStack Query hooks for employee management.
 * Uses IPC transport to fetch/mutate data from main process.
 *
 * @module renderer/lib/hooks/useEmployees
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type Employee,
  type EmployeeListResponse,
  type CreateEmployeeRequest,
  type CreateEmployeeResponse,
  type UpdateEmployeeRequest,
  type UpdateEmployeeResponse,
  type UpdatePinRequest,
  type UpdatePinResponse,
  type ToggleStatusResponse,
} from '../transport';

// ============================================================================
// Query Keys
// ============================================================================

export const employeeKeys = {
  all: ['employees'] as const,
  lists: () => [...employeeKeys.all, 'list'] as const,
  list: () => [...employeeKeys.lists()] as const,
};

// ============================================================================
// List Hooks
// ============================================================================

/**
 * Hook to fetch all employees for the current store
 * Requires store manager role
 */
export function useEmployees(options?: { enabled?: boolean }) {
  return useQuery<EmployeeListResponse>({
    queryKey: employeeKeys.list(),
    queryFn: () => ipc.employees.list(),
    enabled: options?.enabled !== false,
    staleTime: 30000, // 30 seconds
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new employee
 * Requires store manager role
 */
export function useCreateEmployee() {
  const queryClient = useQueryClient();

  return useMutation<CreateEmployeeResponse, Error, CreateEmployeeRequest>({
    mutationFn: (data) => ipc.employees.create(data),
    onSuccess: () => {
      // Invalidate employee list to refresh
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
    },
  });
}

/**
 * Hook to update an employee's details
 * Requires store manager role
 */
export function useUpdateEmployee() {
  const queryClient = useQueryClient();

  return useMutation<UpdateEmployeeResponse, Error, UpdateEmployeeRequest>({
    mutationFn: (data) => ipc.employees.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
    },
  });
}

/**
 * Hook to update an employee's PIN
 * Requires current PIN verification
 */
export function useUpdateEmployeePin() {
  const queryClient = useQueryClient();

  return useMutation<UpdatePinResponse, Error, UpdatePinRequest>({
    mutationFn: (data) => ipc.employees.updatePin(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
    },
  });
}

/**
 * Hook to deactivate an employee
 * Requires store manager role
 */
export function useDeactivateEmployee() {
  const queryClient = useQueryClient();

  return useMutation<ToggleStatusResponse, Error, string>({
    mutationFn: (userId) => ipc.employees.deactivate(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
    },
  });
}

/**
 * Hook to reactivate an employee
 * Requires store manager role
 */
export function useReactivateEmployee() {
  const queryClient = useQueryClient();

  return useMutation<ToggleStatusResponse, Error, string>({
    mutationFn: (userId) => ipc.employees.reactivate(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.lists() });
    },
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to invalidate employee queries
 */
export function useInvalidateEmployees() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
    invalidateList: () => queryClient.invalidateQueries({ queryKey: employeeKeys.lists() }),
  };
}

// Re-export types for convenience
export type { Employee, EmployeeListResponse };
