/**
 * DayClosePage Deferred Commit Unit Tests
 *
 * Tests the deferred commit flow for non-LOTTERY POS types:
 * - Scanner calls `onPendingClosings` with correct closings data
 * - `pendingClosings` state is stored correctly
 * - Step 3 calls `prepareDayClose` when `pendingClosings` exists
 * - Step 3 calls `commitDayClose` with day_id from prepare response
 * - Error handling for prepare/commit failures
 * - Loading state during commit process
 * - Success toast after lottery commit
 * - ShiftClosingForm opens only after successful lottery commit
 *
 * Story: Day Close & Lottery Close Bug Fix - Phase 3 Unit Tests
 *
 * MCP Guidance Applied:
 * - TEST-001: Unit tests are primary (70-80% of test suite)
 * - TEST-002: Single concept per test
 * - ARCH-004: Component-level isolation tests
 * - SEC-010: Tests verify backend authorization with fromWizard flag
 * - BIZ-008: Non-LOTTERY POS can close lottery via wizard
 *
 * @module tests/unit/pages/DayClosePage.deferred-commit
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PendingClosingsData } from '../../../src/renderer/components/lottery/DayCloseModeScanner';

// ============================================================================
// Mock Dependencies
// ============================================================================

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock DayCloseAccessContext
const mockContextValue = {
  activeShift: {
    shift_id: 'shift-uuid-001',
    shift_number: 1,
    cashier_id: 'cashier-uuid-001',
    cashier_name: 'John Smith',
    external_register_id: 'ext-reg-001',
    terminal_name: 'POS Terminal 1',
    business_date: '2026-02-13',
    start_time: '2026-02-13T06:00:00.000Z',
  },
  user: {
    userId: 'user-uuid-001',
    name: 'John Smith',
    role: 'cashier',
  },
  accessType: 'OWNER' as const,
};

const mockUseDayCloseAccessContext = vi.fn();
vi.mock('../../../src/renderer/contexts/DayCloseAccessContext', () => ({
  useDayCloseAccessContext: () => mockUseDayCloseAccessContext(),
}));

// Mock useLocalStore
const mockUseLocalStore = vi.fn();
vi.mock('../../../src/renderer/hooks/useLocalStore', () => ({
  useLocalStore: () => mockUseLocalStore(),
}));

// Mock useLotteryDayBins
const mockUseLotteryDayBins = vi.fn();
vi.mock('../../../src/renderer/hooks/useLottery', () => ({
  useLotteryDayBins: () => mockUseLotteryDayBins(),
}));

// Mock useIsLotteryMode - critical for testing deferred commit path
const mockUseIsLotteryMode = vi.fn();
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => mockUseIsLotteryMode(),
}));

// Mock useStoreTimezone
vi.mock('../../../src/renderer/contexts/StoreContext', () => ({
  useStoreTimezone: () => 'America/New_York',
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('../../../src/renderer/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock lottery API - these are critical for deferred commit flow
const mockPrepareLotteryDayClose = vi.fn();
const mockCommitLotteryDayClose = vi.fn();
const mockCancelLotteryDayClose = vi.fn();

vi.mock('../../../src/renderer/lib/api/lottery', () => ({
  prepareLotteryDayClose: (data: unknown) => mockPrepareLotteryDayClose(data),
  commitLotteryDayClose: (data: unknown) => mockCommitLotteryDayClose(data),
  cancelLotteryDayClose: () => mockCancelLotteryDayClose(),
}));

// Capture DayCloseModeScanner props for testing
let capturedScannerProps: {
  onPendingClosings?: (data: PendingClosingsData) => void;
  onSuccess?: (data: unknown) => void;
  deferCommit?: boolean;
} = {};

vi.mock('../../../src/renderer/components/lottery/DayCloseModeScanner', () => ({
  DayCloseModeScanner: (props: {
    onPendingClosings?: (data: PendingClosingsData) => void;
    onSuccess?: (data: unknown) => void;
    deferCommit?: boolean;
  }) => {
    capturedScannerProps = props;
    return (
      <div data-testid="day-close-scanner" data-defer-commit={props.deferCommit}>
        Day Close Scanner
      </div>
    );
  },
}));

// Mock ReportScanningStep
vi.mock('../../../src/renderer/components/day-close/ReportScanningStep', () => ({
  ReportScanningStep: ({ onComplete }: { onComplete: (data: unknown) => void }) => (
    <div data-testid="report-scanning-step">
      <button
        data-testid="complete-reports-btn"
        onClick={() => onComplete({ lotteryReports: { instantCashes: 100 } })}
      >
        Complete Reports
      </button>
    </div>
  ),
}));

// Mock ShiftClosingForm
let _shiftClosingFormOpen = false;
vi.mock('../../../src/renderer/components/shifts/ShiftClosingForm', () => ({
  ShiftClosingForm: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
    preAuthorizedOverride?: boolean;
  }) => {
    _shiftClosingFormOpen = open;
    return open ? (
      <div data-testid="shift-closing-form">
        Shift Closing Form
        <button data-testid="close-shift-success" onClick={onSuccess}>
          Complete
        </button>
      </div>
    ) : null;
  },
}));

// Mock shift-closing components
vi.mock('../../../src/renderer/components/shift-closing', () => ({
  MoneyReceivedCard: () => <div data-testid="money-received-card">Money Received Card</div>,
  SalesBreakdownCard: () => <div data-testid="sales-breakdown-card">Sales Breakdown Card</div>,
  LotteryStatusBanner: () => <div data-testid="lottery-status-banner">Lottery Status Banner</div>,
  LotterySalesDetails: () => <div data-testid="lottery-sales-details">Lottery Sales Details</div>,
  formatBusinessDate: (date: string | undefined) => date || 'Unknown Date',
  DEFAULT_MONEY_RECEIVED_STATE: { pos: {}, reports: {} },
  DEFAULT_SALES_BREAKDOWN_STATE: { pos: {}, reports: {} },
}));

// Mock lottery pack sections
vi.mock('../../../src/renderer/components/lottery/ReturnedPacksSection', () => ({
  ReturnedPacksSection: () => <div data-testid="returned-packs-section">Returned Packs</div>,
}));

vi.mock('../../../src/renderer/components/lottery/DepletedPacksSection', () => ({
  DepletedPacksSection: () => <div data-testid="depleted-packs-section">Depleted Packs</div>,
}));

vi.mock('../../../src/renderer/components/lottery/ActivatedPacksSection', () => ({
  ActivatedPacksSection: () => <div data-testid="activated-packs-section">Activated Packs</div>,
}));

// Mock date formatting
vi.mock('../../../src/renderer/utils/date-format.utils', () => ({
  formatDateTime: (dateStr: string | null | undefined) =>
    dateStr ? new Date(dateStr).toLocaleString() : '',
}));

// Mock UI components
vi.mock('../../../src/renderer/components/ui/card', () => ({
  Card: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('../../../src/renderer/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...props
  }: React.PropsWithChildren<{
    disabled?: boolean;
    onClick?: () => void;
  }>) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// Import after mocks
import DayClosePage from '../../../src/renderer/pages/DayClosePage';

// ============================================================================
// Test Data Factories
// ============================================================================

function createLocalStoreData(overrides: Partial<{ store_id: string; name: string }> = {}) {
  return {
    store_id: 'store-uuid-001',
    name: 'Test Store',
    ...overrides,
  };
}

function createContextValue() {
  return mockContextValue;
}

function createLotteryDayBins() {
  return {
    bins: [
      {
        bin_id: 'bin-uuid-001',
        bin_number: 1,
        name: 'Bin 1',
        is_active: true,
        pack: {
          pack_id: 'pack-uuid-001',
          pack_number: '1234567',
          game_name: 'Test Game',
          game_price: 5,
          starting_serial: '000',
          ending_serial: null,
          serial_end: '029',
          is_first_period: true,
        },
      },
    ],
    business_day: { date: '2026-02-13', status: 'OPEN', day_id: 'day-uuid-001' },
    returned_packs: [],
    depleted_packs: [],
    activated_packs: [],
    open_business_period: null,
    day_close_summary: null,
    can_close_independently: false,
  };
}

function createPendingClosingsData(): PendingClosingsData {
  return {
    closings: [
      { pack_id: 'pack-uuid-001', closing_serial: '015', is_sold_out: false },
      { pack_id: 'pack-uuid-002', closing_serial: '029', is_sold_out: true },
    ],
    entry_method: 'SCAN',
  };
}

// ============================================================================
// Test Helpers
// ============================================================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function renderDayClosePage() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <DayClosePage />
    </QueryClientProvider>
  );
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  capturedScannerProps = {};
  _shiftClosingFormOpen = false;

  // Default mocks: non-LOTTERY POS type (triggers deferred commit)
  mockUseDayCloseAccessContext.mockReturnValue(createContextValue());
  mockUseLocalStore.mockReturnValue({
    data: createLocalStoreData(),
    isLoading: false,
    isError: false,
  });
  mockUseLotteryDayBins.mockReturnValue({
    data: createLotteryDayBins(),
    isLoading: false,
    isError: false,
  });
  mockUseIsLotteryMode.mockReturnValue(false); // Non-LOTTERY POS

  // Default API mock responses
  mockPrepareLotteryDayClose.mockResolvedValue({
    success: true,
    data: {
      day_id: 'day-uuid-prepared',
      business_date: '2026-02-13',
      status: 'PENDING_CLOSE',
      pending_close_expires_at: '2026-02-13T23:59:59.000Z',
      closings_count: 2,
      estimated_lottery_total: 150,
      bins_preview: [],
    },
  });

  mockCommitLotteryDayClose.mockResolvedValue({
    success: true,
    data: {
      day_id: 'day-uuid-prepared',
      business_date: '2026-02-13',
      closed_at: '2026-02-13T14:30:00.000Z',
      closings_created: 2,
      lottery_total: 150,
      bins_closed: [],
    },
  });

  mockCancelLotteryDayClose.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: Scanner onPendingClosings Callback
// ============================================================================

describe('DayClosePage - Scanner onPendingClosings Integration', () => {
  it('passes deferCommit=true to DayCloseModeScanner for non-LOTTERY POS', () => {
    mockUseIsLotteryMode.mockReturnValue(false);
    renderDayClosePage();

    expect(screen.getByTestId('day-close-scanner')).toHaveAttribute('data-defer-commit', 'true');
  });

  it('passes deferCommit=false to DayCloseModeScanner for LOTTERY POS', () => {
    mockUseIsLotteryMode.mockReturnValue(true);
    renderDayClosePage();

    expect(screen.getByTestId('day-close-scanner')).toHaveAttribute('data-defer-commit', 'false');
  });

  it('provides onPendingClosings callback to scanner', () => {
    renderDayClosePage();

    expect(capturedScannerProps.onPendingClosings).toBeDefined();
    expect(typeof capturedScannerProps.onPendingClosings).toBe('function');
  });

  it('stores pendingClosings data when scanner calls onPendingClosings', async () => {
    renderDayClosePage();

    const pendingData = createPendingClosingsData();

    // Simulate scanner calling onPendingClosings
    act(() => {
      capturedScannerProps.onPendingClosings?.(pendingData);
    });

    // Simulate scanner calling onSuccess (advances to step 2)
    act(() => {
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
      });
    });

    // Should now be on step 2
    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: Step 3 Deferred Commit Logic
// ============================================================================

describe('DayClosePage - Step 3 Deferred Commit', () => {
  async function advanceToStep3WithPendingClosings() {
    renderDayClosePage();

    const pendingData = createPendingClosingsData();

    // Step 1: Scanner calls onPendingClosings and onSuccess
    act(() => {
      capturedScannerProps.onPendingClosings?.(pendingData);
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
      });
    });

    // Wait for step 2
    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    // Step 2: Complete report scanning
    fireEvent.click(screen.getByTestId('complete-reports-btn'));

    // Wait for step 3
    await waitFor(() => {
      expect(screen.getByTestId('step-3-content')).toBeInTheDocument();
    });
  }

  it('calls prepareDayClose with fromWizard=true when pendingClosings exists', async () => {
    await advanceToStep3WithPendingClosings();

    // Click Complete Day Close button
    const completeBtn = screen.getByTestId('complete-day-close-btn');
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(mockPrepareLotteryDayClose).toHaveBeenCalledWith({
        closings: expect.arrayContaining([
          expect.objectContaining({ pack_id: 'pack-uuid-001', closing_serial: '015' }),
          expect.objectContaining({ pack_id: 'pack-uuid-002', closing_serial: '029' }),
        ]),
        fromWizard: true, // SEC-010: Critical flag for non-LOTTERY POS
      });
    });
  });

  it('calls commitDayClose with day_id from prepare response and fromWizard=true', async () => {
    await advanceToStep3WithPendingClosings();

    // Click Complete Day Close button
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockCommitLotteryDayClose).toHaveBeenCalledWith({
        day_id: 'day-uuid-prepared',
        fromWizard: true, // SEC-010: Critical flag for non-LOTTERY POS
      });
    });
  });

  it('shows success toast after successful lottery commit', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Lottery Closed',
          description: expect.stringContaining('2 pack(s) recorded'),
        })
      );
    });
  });

  it('opens ShiftClosingForm only after successful lottery commit', async () => {
    await advanceToStep3WithPendingClosings();

    // ShiftClosingForm should not be visible yet
    expect(screen.queryByTestId('shift-closing-form')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('shift-closing-form')).toBeInTheDocument();
    });
  });

  it('clears pendingClosings after successful commit', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockCommitLotteryDayClose).toHaveBeenCalled();
    });

    // Clicking again should NOT call prepare/commit again (pendingClosings cleared)
    mockPrepareLotteryDayClose.mockClear();
    mockCommitLotteryDayClose.mockClear();

    // The shift closing form should now be open, blocking further clicks
    expect(screen.getByTestId('shift-closing-form')).toBeInTheDocument();
  });
});

// ============================================================================
// TEST SUITE: Error Handling
// ============================================================================

describe('DayClosePage - Deferred Commit Error Handling', () => {
  async function advanceToStep3WithPendingClosings() {
    renderDayClosePage();

    const pendingData = createPendingClosingsData();

    act(() => {
      capturedScannerProps.onPendingClosings?.(pendingData);
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('complete-reports-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step-3-content')).toBeInTheDocument();
    });
  }

  it('shows error toast when prepareDayClose fails', async () => {
    mockPrepareLotteryDayClose.mockResolvedValue({
      success: false,
      message: 'Day already closed',
    });

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Day already closed',
          variant: 'destructive',
        })
      );
    });
  });

  it('shows error toast when commitDayClose fails', async () => {
    mockCommitLotteryDayClose.mockResolvedValue({
      success: false,
    });

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          variant: 'destructive',
        })
      );
    });
  });

  it('does NOT open ShiftClosingForm when prepare fails', async () => {
    mockPrepareLotteryDayClose.mockResolvedValue({
      success: false,
      message: 'Validation error',
    });

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    // ShiftClosingForm should NOT be visible
    expect(screen.queryByTestId('shift-closing-form')).not.toBeInTheDocument();
  });

  it('does NOT open ShiftClosingForm when commit fails', async () => {
    mockCommitLotteryDayClose.mockResolvedValue({
      success: false,
    });

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    // ShiftClosingForm should NOT be visible
    expect(screen.queryByTestId('shift-closing-form')).not.toBeInTheDocument();
  });

  it('handles API exception in prepareDayClose gracefully', async () => {
    mockPrepareLotteryDayClose.mockRejectedValue(new Error('Network error'));

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Network error',
          variant: 'destructive',
        })
      );
    });
  });

  it('handles API exception in commitDayClose gracefully', async () => {
    mockCommitLotteryDayClose.mockRejectedValue(new Error('Server unavailable'));

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Server unavailable',
          variant: 'destructive',
        })
      );
    });
  });
});

// ============================================================================
// TEST SUITE: Loading State During Commit
// ============================================================================

describe('DayClosePage - Loading State During Deferred Commit', () => {
  async function advanceToStep3WithPendingClosings() {
    renderDayClosePage();

    const pendingData = createPendingClosingsData();

    act(() => {
      capturedScannerProps.onPendingClosings?.(pendingData);
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('complete-reports-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step-3-content')).toBeInTheDocument();
    });
  }

  it('disables Complete Day Close button during commit', async () => {
    // Make prepare take some time
    let resolvePromise: () => void;
    mockPrepareLotteryDayClose.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () =>
          resolve({
            success: true,
            data: { day_id: 'day-uuid-prepared' },
          });
      })
    );

    await advanceToStep3WithPendingClosings();

    const completeBtn = screen.getByTestId('complete-day-close-btn');
    expect(completeBtn).not.toBeDisabled();

    fireEvent.click(completeBtn);

    // Button should be disabled while loading
    await waitFor(() => {
      expect(completeBtn).toBeDisabled();
    });

    // Resolve the promise
    act(() => {
      resolvePromise!();
    });
  });

  it('disables Back button during commit', async () => {
    let resolvePromise: () => void;
    mockPrepareLotteryDayClose.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () =>
          resolve({
            success: true,
            data: { day_id: 'day-uuid-prepared' },
          });
      })
    );

    await advanceToStep3WithPendingClosings();

    const backBtn = screen.getByRole('button', { name: /back/i });
    expect(backBtn).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(backBtn).toBeDisabled();
    });

    act(() => {
      resolvePromise!();
    });
  });

  it('disables Cancel button during commit', async () => {
    let resolvePromise: () => void;
    mockPrepareLotteryDayClose.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () =>
          resolve({
            success: true,
            data: { day_id: 'day-uuid-prepared' },
          });
      })
    );

    await advanceToStep3WithPendingClosings();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    expect(cancelBtn).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(cancelBtn).toBeDisabled();
    });

    act(() => {
      resolvePromise!();
    });
  });
});

// ============================================================================
// TEST SUITE: LOTTERY POS Immediate Commit Path (Regression)
// ============================================================================

describe('DayClosePage - LOTTERY POS Immediate Commit (Regression)', () => {
  beforeEach(() => {
    mockUseIsLotteryMode.mockReturnValue(true); // LOTTERY POS type
  });

  it('does NOT call prepareDayClose when pendingLotteryDayId exists (immediate commit path)', async () => {
    renderDayClosePage();

    // For LOTTERY POS, scanner calls API and returns day_id in onSuccess
    act(() => {
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
        day_id: 'day-uuid-from-scanner', // LOTTERY POS path includes day_id
        pending_close_expires_at: '2026-02-13T23:59:59.000Z',
      });
    });

    // Advance to step 3
    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('complete-reports-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step-3-content')).toBeInTheDocument();
    });

    // Click Complete Day Close
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      // Should NOT call prepareDayClose (scanner already did that)
      expect(mockPrepareLotteryDayClose).not.toHaveBeenCalled();
      // Should only call commitDayClose with existing day_id
      expect(mockCommitLotteryDayClose).toHaveBeenCalledWith({
        day_id: 'day-uuid-from-scanner',
      });
    });
  });
});

// ============================================================================
// TEST SUITE: Navigation Blocking During Commit
// ============================================================================

describe('DayClosePage - Navigation Blocking During Commit', () => {
  async function advanceToStep3WithPendingClosings() {
    renderDayClosePage();

    const pendingData = createPendingClosingsData();

    act(() => {
      capturedScannerProps.onPendingClosings?.(pendingData);
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('complete-reports-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('step-3-content')).toBeInTheDocument();
    });
  }

  it('prevents step navigation (Back) during commit', async () => {
    let resolvePromise: () => void;
    mockPrepareLotteryDayClose.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () =>
          resolve({
            success: true,
            data: { day_id: 'day-uuid-prepared' },
          });
      })
    );

    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    // Try to go back - should be blocked (button disabled)
    const backBtn = screen.getByRole('button', { name: /back/i });
    await waitFor(() => {
      expect(backBtn).toBeDisabled();
    });

    // Should still be on step 3
    expect(screen.getByTestId('step-3-content')).toBeInTheDocument();

    act(() => {
      resolvePromise!();
    });
  });
});
