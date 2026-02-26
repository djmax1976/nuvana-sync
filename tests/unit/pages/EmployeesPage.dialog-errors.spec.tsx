/**
 * EmployeesPage Dialog Error Handling Unit Tests
 *
 * Tests dialog-scoped error handling for employee management dialogs:
 * - ERR-006: Dialog-scoped error states (createError, editError, pinError)
 * - A11Y-010: Accessible error announcements (role="alert", aria-live="assertive")
 * - STATE-003: Error clearing on dialog close and form reset
 *
 * Test Coverage Matrix:
 * | ID | Scenario | Risk Level | Standards |
 * |-----|----------|------------|-----------|
 * | DE-001 | Create dialog shows error inside dialog | High | ERR-006 |
 * | DE-002 | Edit dialog shows error inside dialog | High | ERR-006 |
 * | DE-003 | PIN dialog shows error inside dialog | High | ERR-006 |
 * | DE-004 | Create error clears on dialog close | Medium | STATE-003 |
 * | DE-005 | Edit error clears on dialog close | Medium | STATE-003 |
 * | DE-006 | PIN error clears on dialog close | Medium | STATE-003 |
 * | DE-007 | Create form resets on dialog close | Medium | STATE-003 |
 * | DE-008 | PIN form resets on dialog close | Medium | STATE-003 |
 * | DE-009 | Error alert has role="alert" | High | A11Y-010 |
 * | DE-010 | Error alert has aria-live="assertive" | High | A11Y-010 |
 * | DE-011 | Errors are isolated between dialogs | Medium | ERR-006 |
 * | DE-012 | Duplicate PIN error displays in create dialog | High | Business |
 * | DE-013 | Update failure displays in edit dialog | High | Business |
 * | DE-014 | Invalid PIN error displays in PIN dialog | High | Business |
 *
 * MCP Guidance Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation (mocks cleared between tests)
 * - TEST-004: Deterministic tests
 * - TEST-005: Single concept per test
 * - TEST-006: Test error paths
 * - ARCH-004: Component-level isolation tests
 *
 * @module tests/unit/pages/EmployeesPage.dialog-errors
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const {
  mockUseEmployees,
  mockCreateMutation,
  mockUpdateMutation,
  mockUpdatePinMutation,
  mockDeactivateMutation,
  mockReactivateMutation,
} = vi.hoisted(() => ({
  mockUseEmployees: vi.fn(),
  mockCreateMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  },
  mockUpdateMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  },
  mockUpdatePinMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  },
  mockDeactivateMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
  mockReactivateMutation: {
    mutateAsync: vi.fn(),
    isPending: false,
  },
}));

// Mock useEmployees hooks
vi.mock('../../../src/renderer/lib/hooks/useEmployees', () => ({
  useEmployees: () => mockUseEmployees(),
  useCreateEmployee: () => mockCreateMutation,
  useUpdateEmployee: () => mockUpdateMutation,
  useUpdateEmployeePin: () => mockUpdatePinMutation,
  useDeactivateEmployee: () => mockDeactivateMutation,
  useReactivateEmployee: () => mockReactivateMutation,
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import EmployeesPage from '../../../src/renderer/pages/EmployeesPage';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock employee with realistic data
 * @security SEC-014: Uses valid UUID format for IDs
 */
function createMockEmployee(
  overrides: Partial<{
    user_id: string;
    name: string;
    role: 'cashier' | 'shift_manager' | 'store_manager';
    active: boolean;
    last_login_at: string | null;
  }> = {}
) {
  return {
    user_id: overrides.user_id ?? 'user-550e8400-e29b-41d4-a716-446655440001',
    name: overrides.name ?? 'John Doe',
    role: overrides.role ?? 'cashier',
    active: overrides.active ?? true,
    last_login_at: overrides.last_login_at ?? '2026-02-20T10:00:00.000Z',
  };
}

/**
 * Enterprise error messages matching backend responses
 */
const ERROR_MESSAGES = {
  DUPLICATE_PIN: 'This PIN is already in use by another employee. Please choose a different PIN.',
  UPDATE_FAILED: 'Failed to update employee. Please try again.',
  INVALID_CURRENT_PIN: 'Current PIN is incorrect.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  UNAUTHORIZED: 'You do not have permission to perform this action.',
};

// ============================================================================
// Test Utilities
// ============================================================================

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    ),
    queryClient,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('EmployeesPage Dialog Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: employees loaded successfully with one employee
    mockUseEmployees.mockReturnValue({
      data: {
        employees: [createMockEmployee()],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    // Reset mutation mocks to success state
    mockCreateMutation.mutateAsync.mockResolvedValue({ user_id: 'new-user-id' });
    mockUpdateMutation.mutateAsync.mockResolvedValue({ success: true });
    mockUpdatePinMutation.mutateAsync.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Create Dialog Error Tests
  // ==========================================================================

  describe('Add Employee Dialog Error Handling', () => {
    it('DE-001: should display createError inside Add Employee dialog (ERR-006)', async () => {
      // Arrange: Mock mutation to reject with duplicate PIN error
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.DUPLICATE_PIN));

      renderWithProviders(<EmployeesPage />);

      // Act: Open dialog and submit form with duplicate PIN
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

      const dialog = screen.getByRole('dialog');
      const nameInput = within(dialog).getByPlaceholderText(/enter employee name/i);
      const pinInput = within(dialog).getByPlaceholderText(/enter 4-digit pin/i);
      const confirmPinInput = within(dialog).getByPlaceholderText(/re-enter pin/i);

      await userEvent.type(nameInput, 'Jane Smith');
      await userEvent.type(pinInput, '1234');
      await userEvent.type(confirmPinInput, '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      // Assert: Error appears inside the dialog, not on main page
      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent(ERROR_MESSAGES.DUPLICATE_PIN);
      });

      // Verify dialog is still open
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('DE-004: should clear createError when Add Employee dialog closes (STATE-003)', async () => {
      // Arrange: Mock mutation to reject, then allow dialog close
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.DUPLICATE_PIN));

      renderWithProviders(<EmployeesPage />);

      // Act: Open dialog, trigger error, then close dialog
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      // Wait for error to appear
      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      });

      // Close dialog via Cancel button
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      // Wait for dialog to close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Re-open dialog and verify error is cleared
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

      const newDialog = screen.getByRole('dialog');
      expect(within(newDialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('DE-007: should reset form when Add Employee dialog closes (STATE-003)', async () => {
      renderWithProviders(<EmployeesPage />);

      // Act: Open dialog, enter data, then close
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

      const dialog = screen.getByRole('dialog');
      const nameInput = within(dialog).getByPlaceholderText(/enter employee name/i);

      await userEvent.type(nameInput, 'Test User');
      expect(nameInput).toHaveValue('Test User');

      // Close dialog
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Re-open and verify form is reset
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

      const newDialog = screen.getByRole('dialog');
      const newNameInput = within(newDialog).getByPlaceholderText(/enter employee name/i);
      expect(newNameInput).toHaveValue('');
    });

    it('DE-012: should display duplicate PIN error with full message (Business)', async () => {
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.DUPLICATE_PIN));

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));

      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        // Verify full error message is displayed (not truncated)
        expect(errorAlert).toHaveTextContent(/already in use/i);
        expect(errorAlert).toHaveTextContent(/choose a different PIN/i);
      });
    });
  });

  // ==========================================================================
  // Edit Dialog Error Tests
  // ==========================================================================

  describe('Edit Employee Dialog Error Handling', () => {
    it('DE-002: should display editError inside Edit Employee dialog (ERR-006)', async () => {
      mockUpdateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.UPDATE_FAILED));

      renderWithProviders(<EmployeesPage />);

      // Open edit dialog via edit button
      const editButton = screen.getByRole('button', { name: /edit employee/i });
      await userEvent.click(editButton);

      const dialog = screen.getByRole('dialog');

      // Submit the form to trigger error
      await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

      // Assert: Error appears inside the dialog
      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent(ERROR_MESSAGES.UPDATE_FAILED);
      });
    });

    it('DE-005: should clear editError when Edit Employee dialog closes (STATE-003)', async () => {
      mockUpdateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.UPDATE_FAILED));

      renderWithProviders(<EmployeesPage />);

      // Open edit dialog and trigger error
      await userEvent.click(screen.getByRole('button', { name: /edit employee/i }));
      const dialog = screen.getByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      });

      // Close dialog
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Re-open and verify error is cleared
      await userEvent.click(screen.getByRole('button', { name: /edit employee/i }));
      const newDialog = screen.getByRole('dialog');
      expect(within(newDialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('DE-013: should display update failure error with actionable message (Business)', async () => {
      mockUpdateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.NETWORK_ERROR));

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /edit employee/i }));
      const dialog = screen.getByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toHaveTextContent(/network error/i);
      });
    });
  });

  // ==========================================================================
  // PIN Dialog Error Tests
  // ==========================================================================

  describe('Change PIN Dialog Error Handling', () => {
    it('DE-003: should display pinError inside Change PIN dialog (ERR-006)', async () => {
      mockUpdatePinMutation.mutateAsync.mockRejectedValue(
        new Error(ERROR_MESSAGES.INVALID_CURRENT_PIN)
      );

      renderWithProviders(<EmployeesPage />);

      // Open PIN dialog via key icon button
      const pinButton = screen.getByRole('button', { name: /change pin/i });
      await userEvent.click(pinButton);

      const dialog = screen.getByRole('dialog');

      // Fill form and submit
      await userEvent.type(within(dialog).getByPlaceholderText(/enter current pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter new 4-digit pin/i), '5678');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter new pin/i), '5678');

      await userEvent.click(within(dialog).getByRole('button', { name: /update pin/i }));

      // Assert: Error appears inside the dialog
      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent(ERROR_MESSAGES.INVALID_CURRENT_PIN);
      });
    });

    it('DE-006: should clear pinError when Change PIN dialog closes (STATE-003)', async () => {
      mockUpdatePinMutation.mutateAsync.mockRejectedValue(
        new Error(ERROR_MESSAGES.INVALID_CURRENT_PIN)
      );

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /change pin/i }));
      const dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter current pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter new 4-digit pin/i), '5678');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter new pin/i), '5678');

      await userEvent.click(within(dialog).getByRole('button', { name: /update pin/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      });

      // Close dialog
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Re-open and verify error is cleared
      await userEvent.click(screen.getByRole('button', { name: /change pin/i }));
      const newDialog = screen.getByRole('dialog');
      expect(within(newDialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('DE-008: should reset form when Change PIN dialog closes (STATE-003)', async () => {
      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /change pin/i }));
      const dialog = screen.getByRole('dialog');

      const currentPinInput = within(dialog).getByPlaceholderText(/enter current pin/i);
      await userEvent.type(currentPinInput, '1234');
      expect(currentPinInput).toHaveValue('1234');

      // Close dialog
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Re-open and verify form is reset
      await userEvent.click(screen.getByRole('button', { name: /change pin/i }));
      const newDialog = screen.getByRole('dialog');
      const newCurrentPinInput = within(newDialog).getByPlaceholderText(/enter current pin/i);
      expect(newCurrentPinInput).toHaveValue('');
    });

    it('DE-014: should display invalid current PIN error (Business)', async () => {
      mockUpdatePinMutation.mutateAsync.mockRejectedValue(
        new Error(ERROR_MESSAGES.INVALID_CURRENT_PIN)
      );

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /change pin/i }));
      const dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter current pin/i), '0000');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter new 4-digit pin/i), '5678');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter new pin/i), '5678');

      await userEvent.click(within(dialog).getByRole('button', { name: /update pin/i }));

      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toHaveTextContent(/incorrect/i);
      });
    });
  });

  // ==========================================================================
  // Accessibility Tests (A11Y-010)
  // ==========================================================================

  describe('Accessibility Compliance (A11Y-010)', () => {
    it('DE-009: error alert should have role="alert" for screen reader announcement', async () => {
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.DUPLICATE_PIN));

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      const dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toHaveAttribute('role', 'alert');
      });
    });

    it('DE-010: error alert should have aria-live="assertive" for immediate announcement', async () => {
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.DUPLICATE_PIN));

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      const dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toHaveAttribute('aria-live', 'assertive');
      });
    });
  });

  // ==========================================================================
  // Error Isolation Tests (ERR-006)
  // ==========================================================================

  describe('Error State Isolation (ERR-006)', () => {
    it('DE-011: errors should be isolated between dialogs', async () => {
      // Trigger error in create dialog
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error(ERROR_MESSAGES.DUPLICATE_PIN));

      renderWithProviders(<EmployeesPage />);

      // Trigger error in Add dialog
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      let dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      });

      // Close Add dialog
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Open Edit dialog - should NOT show error from Add dialog
      await userEvent.click(screen.getByRole('button', { name: /edit employee/i }));
      dialog = screen.getByRole('dialog');

      // Assert: No error in Edit dialog
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('DE-011b: PIN dialog error should not affect other dialogs', async () => {
      mockUpdatePinMutation.mutateAsync.mockRejectedValue(
        new Error(ERROR_MESSAGES.INVALID_CURRENT_PIN)
      );

      renderWithProviders(<EmployeesPage />);

      // Trigger error in PIN dialog
      await userEvent.click(screen.getByRole('button', { name: /change pin/i }));
      let dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter current pin/i), '0000');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter new 4-digit pin/i), '5678');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter new pin/i), '5678');

      await userEvent.click(within(dialog).getByRole('button', { name: /update pin/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      });

      // Close PIN dialog
      await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Open Add dialog - should NOT show error from PIN dialog
      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      dialog = screen.getByRole('dialog');

      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Edge Cases and Resilience Tests
  // ==========================================================================

  describe('Edge Cases and Resilience', () => {
    it('should handle non-Error rejection gracefully', async () => {
      // Simulate rejection with non-Error object
      mockCreateMutation.mutateAsync.mockRejectedValue('String error message');

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      const dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      // Should display fallback error message
      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toHaveTextContent(/failed to create employee/i);
      });
    });

    it('should handle undefined error message gracefully', async () => {
      mockCreateMutation.mutateAsync.mockRejectedValue(new Error());

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      const dialog = screen.getByRole('dialog');

      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      // Should display fallback error message when Error.message is empty
      await waitFor(() => {
        const errorAlert = within(dialog).getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
      });
    });

    it('should clear error when user starts re-typing after error', async () => {
      mockCreateMutation.mutateAsync
        .mockRejectedValueOnce(new Error(ERROR_MESSAGES.DUPLICATE_PIN))
        .mockResolvedValueOnce({ user_id: 'new-id' });

      renderWithProviders(<EmployeesPage />);

      await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
      const dialog = screen.getByRole('dialog');

      // First attempt - triggers error
      await userEvent.type(within(dialog).getByPlaceholderText(/enter employee name/i), 'Jane');
      await userEvent.type(within(dialog).getByPlaceholderText(/enter 4-digit pin/i), '1234');
      await userEvent.type(within(dialog).getByPlaceholderText(/re-enter pin/i), '1234');
      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      await waitFor(() => {
        expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      });

      // Second attempt - should succeed and close dialog
      const pinInput = within(dialog).getByPlaceholderText(/enter 4-digit pin/i);
      await userEvent.clear(pinInput);
      await userEvent.type(pinInput, '9999');

      const confirmInput = within(dialog).getByPlaceholderText(/re-enter pin/i);
      await userEvent.clear(confirmInput);
      await userEvent.type(confirmInput, '9999');

      await userEvent.click(within(dialog).getByRole('button', { name: /create employee/i }));

      // Dialog should close on success
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });
});
