/**
 * TerminalsPage Phase 5 Unit Tests
 *
 * Tests the TerminalsPage component's Day Close navigation behavior:
 * - 5.T1: Day Close button navigates without state (guard handles everything)
 * - 5.T2: Button hidden when no open shifts (backend-driven visibility)
 *
 * Story: Day Close Access Guard - Phase 5 TerminalsPage Update
 *
 * MCP Guidance Applied:
 * - TEST-001: Unit tests are primary (70-80% of test suite)
 * - TEST-002: Single concept per test
 * - ARCH-004: Component-level isolation tests
 * - SEC-010: Authorization enforced by guard, not TerminalsPage
 * - DB-006: Verifies store-scoped queries via dayStatus
 *
 * @module tests/unit/pages/TerminalsPage.phase5
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Hoist mocks to ensure they're available before vi.mock executes
const {
  mockNavigate,
  mockStoresAPI,
  mockTerminalsAPI,
  mockShiftsAPI,
  mockUsePOSConnectionType,
  mockToast,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockStoresAPI: {
    getInfo: vi.fn(),
  },
  mockTerminalsAPI: {
    list: vi.fn(),
    getDayStatus: vi.fn(),
    onShiftClosed: vi.fn(() => vi.fn()), // Returns unsubscribe function
  },
  mockShiftsAPI: {
    manualStart: vi.fn(),
  },
  mockUsePOSConnectionType: vi.fn(),
  mockToast: vi.fn(),
}));

// Track navigation calls for verification
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock IPC APIs
vi.mock('../../../src/renderer/lib/api/ipc-client', () => ({
  storesAPI: mockStoresAPI,
  terminalsAPI: mockTerminalsAPI,
  shiftsAPI: mockShiftsAPI,
}));

// Mock POS connection type hook
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  usePOSConnectionType: () => mockUsePOSConnectionType(),
}));

// Mock useToast
vi.mock('../../../src/renderer/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock ShiftStartDialog
vi.mock('../../../src/renderer/components/shifts/ShiftStartDialog', () => ({
  ShiftStartDialog: () => null,
}));

// Import the component after all mocks
import TerminalsPage from '../../../src/renderer/pages/TerminalsPage';

// ============================================================================
// Test Helpers
// ============================================================================

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/**
 * Create mock register data for tests
 * @security SEC-014: Uses valid UUID format for IDs
 */
function createMockRegister(
  id: string,
  externalId: string,
  hasActiveShift: boolean = false
) {
  return {
    id,
    external_register_id: externalId,
    description: `Register ${externalId}`,
    openShiftCount: hasActiveShift ? 1 : 0,
    activeShift: hasActiveShift
      ? {
          shift_id: `shift-${id}`,
          shift_number: 1,
          cashier_id: 'cashier-001',
          start_time: '2026-02-12T08:00:00.000Z',
          business_date: '2026-02-12',
        }
      : null,
  };
}

// ============================================================================
// Test Suite: Phase 5 - Day Close Navigation
// ============================================================================

describe('TerminalsPage - Phase 5: Day Close Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: store info returns successfully
    mockStoresAPI.getInfo.mockResolvedValue({
      store_id: 'store-uuid-001',
      name: 'Test Store',
    });

    // Default: terminals list returns empty
    mockTerminalsAPI.list.mockResolvedValue({
      registers: [],
    });

    // Default: day status returns no open shifts
    mockTerminalsAPI.getDayStatus.mockResolvedValue({
      hasOpenShifts: false,
      openShiftCount: 0,
    });

    // Default: not in manual mode
    mockUsePOSConnectionType.mockReturnValue({
      data: { connectionType: 'CLOUD' },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // 5.T1: Day Close button navigates without state
  // ==========================================================================

  describe('5.T1: Day Close button navigates without state', () => {
    it('navigates to /day-close without passing state when Day Close button is clicked', async () => {
      // Arrange: Manual mode with open shifts
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: true,
        openShiftCount: 1,
      });

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      // Wait for data to load and button to appear
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /day close/i })).toBeInTheDocument();
      });

      // Click the Day Close button
      fireEvent.click(screen.getByRole('button', { name: /day close/i }));

      // Assert: navigate was called with just the path, no state
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/day-close');
    });

    it('does NOT pass shiftId, businessDate, or other state to navigation', async () => {
      // Arrange: Manual mode with multiple registers, one with active shift
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: true,
        openShiftCount: 2,
      });

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [
          createMockRegister('reg-001', '1', true),
          createMockRegister('reg-002', '2', true),
        ],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /day close/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /day close/i }));

      // Assert: navigation call has no state object
      expect(mockNavigate).toHaveBeenCalledWith('/day-close');

      // Verify it was NOT called with any state object
      const callArgs = mockNavigate.mock.calls[0];
      expect(callArgs.length).toBe(1); // Only path, no options/state
    });

    it('guard handles validation - page does not compute shift conditions', async () => {
      // Arrange: Manual mode, backend says there are open shifts
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: true,
        openShiftCount: 1,
      });

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /day close/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /day close/i }));

      // Assert: navigation is simple - no conditional logic based on shift data
      expect(mockNavigate).toHaveBeenCalledWith('/day-close');

      // The guard (DayCloseAccessGuard) will handle:
      // - PIN verification
      // - Shift count validation (exactly one)
      // - Ownership/override validation
      // This test confirms TerminalsPage does NOT try to do this itself
    });
  });

  // ==========================================================================
  // 5.T2: Button hidden when no open shifts
  // ==========================================================================

  describe('5.T2: Button hidden when no open shifts', () => {
    it('hides Day Close button when backend reports no open shifts', async () => {
      // Arrange: Manual mode but NO open shifts
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: false,
        openShiftCount: 0,
      });

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', false)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      // Wait for page to render
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });

      // Assert: Day Close button should NOT be present
      expect(screen.queryByRole('button', { name: /day close/i })).not.toBeInTheDocument();
    });

    it('hides Day Close button in CLOUD mode even if shifts are open', async () => {
      // Arrange: CLOUD mode (not MANUAL) with open shifts
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'CLOUD' },
      });

      // Note: dayStatus query is disabled when not in manual mode,
      // but even if it somehow returned data, button should be hidden
      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });

      // Assert: Day Close button should NOT be present
      expect(screen.queryByRole('button', { name: /day close/i })).not.toBeInTheDocument();
    });

    it('shows Day Close button only when MANUAL mode AND backend confirms open shifts', async () => {
      // Arrange: Manual mode WITH open shifts
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: true,
        openShiftCount: 1,
      });

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      // Assert: Day Close button IS present
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /day close/i })).toBeInTheDocument();
      });
    });

    it('uses backend dayStatus for button visibility, not local register data', async () => {
      // Arrange: Manual mode, registers have active shifts BUT backend says no open shifts
      // This tests that we trust backend over local computation
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      // Backend says NO open shifts (authoritative)
      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: false,
        openShiftCount: 0,
      });

      // But local register data shows active shift (should be ignored for button)
      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });

      // Assert: Button hidden because backend is authoritative
      expect(screen.queryByRole('button', { name: /day close/i })).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Additional Phase 5 Tests: Security & Edge Cases
  // ==========================================================================

  describe('Security: SEC-010 Authorization Delegation', () => {
    it('does not perform any client-side authorization checks before navigation', async () => {
      // Arrange
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockResolvedValue({
        hasOpenShifts: true,
        openShiftCount: 1,
      });

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /day close/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /day close/i }));

      // Assert: Navigation happens immediately without prompting for PIN
      // The guard will handle PIN verification, not TerminalsPage
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/day-close');

      // No toast shown for auth errors (guard handles this)
      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles dayStatus query still loading gracefully', async () => {
      // Arrange: Manual mode, dayStatus hasn't resolved yet
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      // Never resolves (simulates loading state)
      mockTerminalsAPI.getDayStatus.mockReturnValue(new Promise(() => {}));

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });

      // Assert: Button not shown while dayStatus is undefined/loading
      expect(screen.queryByRole('button', { name: /day close/i })).not.toBeInTheDocument();
    });

    it('handles dayStatus query error gracefully', async () => {
      // Arrange: Manual mode, dayStatus fails
      mockUsePOSConnectionType.mockReturnValue({
        data: { connectionType: 'MANUAL' },
      });

      mockTerminalsAPI.getDayStatus.mockRejectedValue(new Error('Backend error'));

      mockTerminalsAPI.list.mockResolvedValue({
        registers: [createMockRegister('reg-001', '1', true)],
      });

      // Act
      renderWithProviders(<TerminalsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });

      // Assert: Button not shown when dayStatus query fails
      expect(screen.queryByRole('button', { name: /day close/i })).not.toBeInTheDocument();
    });
  });
});
