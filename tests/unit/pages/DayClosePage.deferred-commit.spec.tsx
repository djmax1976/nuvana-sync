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
// Use vi.hoisted() to ensure mock function is available when vi.mock factory runs (hoisting issue)
const { mockUseIsLotteryMode } = vi.hoisted(() => ({
  mockUseIsLotteryMode: vi.fn(() => false),
}));
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => mockUseIsLotteryMode(),
}));

// Mock useCloseDraft - required for draft lifecycle management
// Use vi.hoisted() for cross-platform compatibility (Windows/Linux mock hoisting)
// FinalizeResponse can be success or failure - use flexible return type
type MockFinalizeResponse =
  | {
      success: true;
      closed_at: string;
      lottery_result: { closings_created: number; day_id: string };
      shift_result: { shift_id: string };
    }
  | { success: false; message?: string };

const {
  mockUpdateLottery,
  mockUpdateReports,
  mockUpdateStepState,
  mockFinalize,
  mockSave,
  mockDiscard,
  mockRetryAfterConflict,
} = vi.hoisted(() => ({
  mockUpdateLottery: vi.fn(),
  mockUpdateReports: vi.fn(),
  mockUpdateStepState: vi.fn(() => Promise.resolve()),
  mockFinalize: vi.fn(
    (): Promise<MockFinalizeResponse> =>
      Promise.resolve({
        success: true,
        closed_at: '2026-02-13T18:00:00Z',
        lottery_result: { closings_created: 2, day_id: 'day-uuid-finalized' },
        shift_result: { shift_id: 'shift-uuid-001' },
      })
  ),
  mockSave: vi.fn(() => Promise.resolve()),
  mockDiscard: vi.fn(() => Promise.resolve()),
  mockRetryAfterConflict: vi.fn(() => Promise.resolve()),
}));

// DRAFT-001: Lottery data in draft payload - required for handleOpenShiftClosingForm guard
const mockLotteryPayload = {
  bins_scans: [
    {
      bin_id: 'bin-uuid-001',
      pack_id: 'pack-uuid-001',
      closing_serial: '015',
      is_sold_out: false,
      scanned_at: '2026-02-13T10:00:00.000Z',
    },
    {
      bin_id: 'bin-uuid-002',
      pack_id: 'pack-uuid-002',
      closing_serial: '029',
      is_sold_out: true,
      scanned_at: '2026-02-13T10:05:00.000Z',
    },
  ],
  totals: { tickets_sold: 44, sales_amount: 220 },
  entry_method: 'SCAN' as const,
};

vi.mock('../../../src/renderer/hooks/useCloseDraft', () => ({
  useCloseDraft: () => ({
    draft: {
      draft_id: 'draft-uuid-001',
      shift_id: 'shift-uuid-001',
      draft_type: 'DAY_CLOSE',
      status: 'IN_PROGRESS',
      payload: { lottery: mockLotteryPayload },
      version: 1,
      created_at: '2026-02-13T06:00:00.000Z',
      updated_at: '2026-02-13T06:00:00.000Z',
    },
    payload: { lottery: mockLotteryPayload },
    isLoading: false,
    isSaving: false,
    isFinalizing: false,
    version: 1,
    isDirty: false,
    error: null,
    hasVersionConflict: false,
    updateLottery: mockUpdateLottery,
    updateReports: mockUpdateReports,
    updateStepState: mockUpdateStepState,
    finalize: mockFinalize,
    save: mockSave,
    discard: mockDiscard,
    retryAfterConflict: mockRetryAfterConflict,
    recoveryInfo: null,
  }),
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

// Mock lucide-react icons used in cash dialog
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    CalendarCheck: () => <span data-testid="icon-calendar-check" />,
    Check: () => <span data-testid="icon-check" />,
    Loader2: () => <span data-testid="icon-loader" />,
    ChevronLeft: () => <span data-testid="icon-chevron-left" />,
    X: () => <span data-testid="icon-x" />,
  };
});

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

// Mock Dialog components for DRAFT-001 cash dialog
vi.mock('../../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: React.PropsWithChildren<{ open?: boolean; onOpenChange?: (open: boolean) => void }>) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <h2 {...props}>{children}</h2>
  ),
  DialogDescription: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}));

// Mock Input component - use factory function to avoid hoisting issues
vi.mock('../../../src/renderer/components/ui/input', () => {
  const MockInput = React.forwardRef<
    HTMLInputElement,
    React.InputHTMLAttributes<HTMLInputElement> & { 'data-testid'?: string }
  >(function MockInput({ ...props }, ref) {
    return <input ref={ref} {...props} />;
  });
  MockInput.displayName = 'MockInput';
  return { Input: MockInput };
});

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
      {
        bin_id: 'bin-uuid-001',
        pack_id: 'pack-uuid-001',
        closing_serial: '015',
        is_sold_out: false,
      },
      {
        bin_id: 'bin-uuid-002',
        pack_id: 'pack-uuid-002',
        closing_serial: '029',
        is_sold_out: true,
      },
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

  it('passes deferCommit=true to DayCloseModeScanner for LOTTERY POS (DRAFT-001 always defers)', () => {
    // DRAFT-001: deferCommit is now always true for ALL POS types
    // The draft system handles all lottery closes atomically
    mockUseIsLotteryMode.mockReturnValue(true);
    renderDayClosePage();

    // With DRAFT-001, deferCommit is ALWAYS true - draft handles both POS types
    expect(screen.getByTestId('day-close-scanner')).toHaveAttribute('data-defer-commit', 'true');
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
// TEST SUITE: Step 3 Deferred Commit Logic (DRAFT-001)
// ============================================================================

describe('DayClosePage - Step 3 Draft-Based Finalization', () => {
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

  it('opens closing cash dialog when Complete Day Close is clicked (DRAFT-001)', async () => {
    await advanceToStep3WithPendingClosings();

    // Click Complete Day Close button
    const completeBtn = screen.getByTestId('complete-day-close-btn');
    fireEvent.click(completeBtn);

    // DRAFT-001: Cash dialog should appear
    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });
  });

  it('calls finalizeDraft when Finalize Day Close is clicked (DRAFT-001)', async () => {
    await advanceToStep3WithPendingClosings();

    // Click Complete Day Close button to open cash dialog
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    // Enter closing cash
    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });

    // Click Finalize Day Close
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      // DRAFT-001: finalizeDraft is called with closing cash amount
      expect(mockFinalize).toHaveBeenCalled();
    });
  });

  it('shows success toast after successful finalization (DRAFT-001)', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Day Closed Successfully',
          description: expect.stringContaining('2 pack(s) recorded'),
        })
      );
    });
  });

  it('navigates to /mystore after successful finalization (DRAFT-001)', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      // DRAFT-001: Navigates to mystore on success (atomic close)
      expect(mockNavigate).toHaveBeenCalledWith('/mystore');
    });
  });

  it('saves draft before opening cash dialog (DRAFT-001)', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      // Draft should be saved before showing dialog
      expect(mockSave).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// TEST SUITE: Error Handling (DRAFT-001)
// ============================================================================

describe('DayClosePage - Draft Finalization Error Handling', () => {
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

  async function openCashDialogAndFinalize() {
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));
  }

  it('shows error toast when finalizeDraft fails', async () => {
    mockFinalize.mockImplementationOnce(() =>
      Promise.resolve({
        success: false,
        message: 'Day already closed',
      })
    );

    await advanceToStep3WithPendingClosings();
    await openCashDialogAndFinalize();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          variant: 'destructive',
        })
      );
    });
  });

  it('does NOT navigate when finalization fails', async () => {
    mockFinalize.mockImplementationOnce(() =>
      Promise.resolve({
        success: false,
      })
    );

    await advanceToStep3WithPendingClosings();
    await openCashDialogAndFinalize();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    // Should NOT navigate on failure
    expect(mockNavigate).not.toHaveBeenCalledWith('/mystore');
  });

  it('handles finalizeDraft exception gracefully', async () => {
    mockFinalize.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

    await advanceToStep3WithPendingClosings();
    await openCashDialogAndFinalize();

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

  it('keeps cash dialog open when finalization fails', async () => {
    mockFinalize.mockImplementationOnce(() =>
      Promise.resolve({
        success: false,
      })
    );

    await advanceToStep3WithPendingClosings();
    await openCashDialogAndFinalize();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    // Cash dialog should still be visible (user can retry)
    expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
  });
});

// ============================================================================
// TEST SUITE: Finalization Flow Tests (DRAFT-001)
// ============================================================================

describe('DayClosePage - Finalization Flow', () => {
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

  it('calls finalize when Finalize Day Close is clicked', async () => {
    await advanceToStep3WithPendingClosings();

    // Open cash dialog
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalled();
    });
  });

  it('closes dialog and navigates on successful finalization', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/mystore');
    });
  });

  it('shows success toast with pack count from finalization result', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Day Closed Successfully',
          description: expect.stringContaining('2 pack(s) recorded'),
        })
      );
    });
  });
});

// ============================================================================
// TEST SUITE: LOTTERY POS Flow (DRAFT-001)
// ============================================================================

describe('DayClosePage - LOTTERY POS Flow (DRAFT-001)', () => {
  it('uses same draft finalization flow for LOTTERY POS', async () => {
    // MUST set this BEFORE rendering
    mockUseIsLotteryMode.mockReturnValue(true);

    renderDayClosePage();

    // For LOTTERY POS, scanner calls API and returns day_id in onSuccess
    act(() => {
      capturedScannerProps.onSuccess?.({
        closings_created: 2,
        business_date: '2026-02-13',
        lottery_total: 150,
        bins_closed: [],
        day_id: 'day-uuid-from-scanner',
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

    // Click Complete Day Close - should open cash dialog
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      // DRAFT-001: Same cash dialog flow for all POS types
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    // Finalize
    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '150.00' } });
    fireEvent.click(screen.getByTestId('finalize-day-close-btn'));

    await waitFor(() => {
      // DRAFT-001: finalizeDraft handles both lottery and shift atomically
      expect(mockFinalize).toHaveBeenCalled();
    });
  });

  it('passes deferCommit=true to scanner for LOTTERY POS (DRAFT-001 always defers)', async () => {
    // MUST set this BEFORE rendering
    mockUseIsLotteryMode.mockReturnValue(true);

    renderDayClosePage();

    // DRAFT-001: deferCommit is ALWAYS true - draft handles both POS types atomically
    expect(screen.getByTestId('day-close-scanner')).toHaveAttribute('data-defer-commit', 'true');
  });
});

// ============================================================================
// TEST SUITE: Dialog Dismissal Behavior (DRAFT-001)
// ============================================================================

describe('DayClosePage - Dialog Dismissal During Finalization', () => {
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

  it('keeps step 3 visible when cash dialog is open', async () => {
    await advanceToStep3WithPendingClosings();

    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    // Step 3 should still be visible behind the dialog
    expect(screen.getByTestId('step-3-content')).toBeInTheDocument();
  });

  it('allows entering closing cash amount', async () => {
    await advanceToStep3WithPendingClosings();

    // Open dialog
    fireEvent.click(screen.getByTestId('complete-day-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    // Enter cash amount
    fireEvent.change(screen.getByTestId('closing-cash-input'), { target: { value: '250.50' } });

    // Verify value is set
    expect(screen.getByTestId('closing-cash-input')).toHaveValue('250.50');
  });
});
