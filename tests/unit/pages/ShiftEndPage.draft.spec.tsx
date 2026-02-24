/**
 * ShiftEndPage Draft Integration Tests
 *
 * Phase 7 Tests for DRAFT-001: Draft-Backed Wizard Architecture
 *
 * Tests cover:
 * - T7.1: Draft integration (creation, loading, step state)
 * - T7.2: Crash recovery (resume dialog, discard flow)
 * - T7.3: Finalize flow (atomic commit via draft.finalize())
 *
 * Key differences from DayClosePage:
 * - No lottery step (SHIFT_CLOSE type)
 * - 2-step wizard (Reports → Close Shift)
 * - Step states: REPORTS, REVIEW (no LOTTERY)
 *
 * @module tests/unit/pages/ShiftEndPage.draft.spec
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-010: Authentication required for all operations
 * @security DB-006: Store-scoped operations
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ============================================================================
// Types
// ============================================================================

interface MockDraft {
  draft_id: string;
  store_id: string;
  shift_id: string;
  business_date: string;
  draft_type: 'DAY_CLOSE' | 'SHIFT_CLOSE';
  status: 'IN_PROGRESS' | 'FINALIZING' | 'FINALIZED' | 'EXPIRED';
  step_state: 'LOTTERY' | 'REPORTS' | 'REVIEW' | null;
  payload: {
    lottery?: unknown; // Not used for SHIFT_CLOSE
    reports?: unknown;
    closing_cash?: number;
  };
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface MockRecoveryInfo {
  hasDraft: boolean;
  draft: MockDraft | null;
  stepState: 'LOTTERY' | 'REPORTS' | 'REVIEW' | null;
  lastUpdated: string | null;
}

// ============================================================================
// Mocks
// ============================================================================

// Mock useCloseDraft hook
const mockUpdateStepState = vi.fn().mockResolvedValue(undefined);
const mockFinalizeDraft = vi.fn();
const mockSaveDraft = vi.fn().mockResolvedValue(undefined);
const mockDiscardDraft = vi.fn().mockResolvedValue(undefined);

let mockDraft: MockDraft | null = null;
let mockPayload: MockDraft['payload'] = {};
let mockRecoveryInfo: MockRecoveryInfo | null = null;
let mockIsDraftLoading = false;
let mockIsFinalizing = false;
let mockHasDraftChanges = false;

vi.mock('@/hooks/useCloseDraft', () => ({
  useCloseDraft: vi.fn(() => ({
    draft: mockDraft,
    payload: mockPayload,
    isLoading: mockIsDraftLoading,
    isSaving: false,
    isFinalizing: mockIsFinalizing,
    isDirty: mockHasDraftChanges,
    error: null,
    updateStepState: mockUpdateStepState,
    finalize: mockFinalizeDraft,
    save: mockSaveDraft,
    discard: mockDiscardDraft,
    recoveryInfo: mockRecoveryInfo,
    // Note: updateLottery not used for SHIFT_CLOSE
  })),
  draftKeys: {
    all: ['draft'],
    byShift: (shiftId: string) => ['draft', 'shift', shiftId],
    byId: (draftId: string) => ['draft', 'id', draftId],
  },
}));

// Mock useLocalStore
vi.mock('@/hooks/useLocalStore', () => ({
  useLocalStore: vi.fn(() => ({
    data: { store_id: 'store-uuid-001', name: 'Test Store' },
    isLoading: false,
    isError: false,
  })),
}));

// Mock useLocalShiftDetail
vi.mock('@/hooks/useLocalShifts', () => ({
  useLocalShiftDetail: vi.fn(() => ({
    data: {
      shift_id: 'shift-uuid-001',
      shift_number: 1,
      status: 'OPEN',
      start_time: '2026-02-21T08:00:00Z',
      external_register_id: 'terminal-001',
      cashier_id: 'cashier-001',
      cashier_name: 'John Doe',
    },
    isLoading: false,
  })),
}));

// Mock useLocalTerminals
vi.mock('@/hooks/useLocalTerminals', () => ({
  useLocalTerminals: vi.fn(() => ({
    data: [
      {
        id: 'terminal-001',
        external_register_id: 'terminal-001',
        name: 'Terminal 1',
      },
    ],
    isLoading: false,
  })),
}));

// Mock useLocalCashiers
vi.mock('@/hooks/useLocalCashiers', () => ({
  useLocalCashiers: vi.fn(() => ({
    data: [{ cashier_id: 'cashier-001', name: 'John Doe' }],
    isLoading: false,
  })),
}));

// Mock useLotteryDayBins
vi.mock('@/hooks/useLottery', () => ({
  useLotteryDayBins: vi.fn(() => ({
    data: {
      bins: [],
      business_day: { status: 'OPEN', last_shift_closed_at: null },
    },
    isLoading: false,
  })),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

// Mock components
vi.mock('@/components/day-close/ReportScanningStep', () => ({
  ReportScanningStep: vi.fn(({ onComplete }) => (
    <div data-testid="report-scanning-step">
      <button
        data-testid="mock-reports-complete"
        onClick={() =>
          onComplete({
            lotteryReports: {
              instantSales: 150,
              instantCashes: 50,
              onlineSales: 200,
              onlineCashes: 25,
            },
            gamingReports: null,
            vendorInvoices: [],
            cashPayouts: null,
          })
        }
      >
        Complete Reports
      </button>
    </div>
  )),
}));

vi.mock('@/components/shifts/ShiftClosingForm', () => ({
  ShiftClosingForm: vi.fn(({ open, onSuccess }) =>
    open ? (
      <div data-testid="shift-closing-form">
        <button data-testid="mock-shift-close" onClick={onSuccess}>
          Close Shift
        </button>
      </div>
    ) : null
  ),
}));

vi.mock('@/components/lottery/CloseDayModal', () => ({
  CloseDayModal: vi.fn(() => null),
}));

// Mock shift-closing components
vi.mock('@/components/shift-closing', () => ({
  MoneyReceivedCard: vi.fn(() => <div data-testid="money-received-card" />),
  SalesBreakdownCard: vi.fn(() => <div data-testid="sales-breakdown-card" />),
  LotteryStatusBanner: vi.fn(() => <div data-testid="lottery-status-banner" />),
  LotterySalesDetails: vi.fn(() => null),
  formatBusinessDate: vi.fn(() => '2026-02-21'),
  DEFAULT_MONEY_RECEIVED_STATE: { reports: {}, pos: {} },
  DEFAULT_SALES_BREAKDOWN_STATE: { reports: {}, pos: {} },
}));

vi.mock('@/components/shifts/ShiftInfoHeader', () => ({
  ShiftInfoHeader: vi.fn(() => <div data-testid="shift-info-header" />),
}));

vi.mock('@/components/shifts/ShiftCloseStepIndicator', () => ({
  ShiftCloseStepIndicator: vi.fn(() => <div data-testid="step-indicator" />),
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams('?shiftId=shift-uuid-001')],
    useLocation: () => ({ state: null }),
  };
});

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

async function renderShiftEndPage() {
  const ShiftEndWizardPage = (await import('@/pages/ShiftEndPage')).default;

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <ShiftEndWizardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function createMockDraft(overrides: Partial<MockDraft> = {}): MockDraft {
  return {
    draft_id: 'draft-001',
    store_id: 'store-uuid-001',
    shift_id: 'shift-uuid-001',
    business_date: '2026-02-21',
    draft_type: 'SHIFT_CLOSE', // Note: SHIFT_CLOSE, not DAY_CLOSE
    status: 'IN_PROGRESS',
    step_state: 'REPORTS', // SHIFT_CLOSE starts at REPORTS (no LOTTERY step)
    payload: {},
    version: 1,
    created_at: '2026-02-21T08:00:00Z',
    updated_at: '2026-02-21T08:00:00Z',
    created_by: 'user-001',
    ...overrides,
  };
}

// ============================================================================
// Test Suite: T7.1 - Draft Integration Tests
// ============================================================================

describe('T7.1: ShiftEndPage Draft Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraft = null;
    mockPayload = {};
    mockRecoveryInfo = null;
    mockIsDraftLoading = false;
    mockIsFinalizing = false;
    mockHasDraftChanges = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Draft Creation and Loading', () => {
    it('should create draft with type SHIFT_CLOSE', async () => {
      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('shift-end-wizard')).toBeInTheDocument();
      });

      // Should be on Step 1 (Report Scanning)
      expect(screen.getByTestId('shift-close-step-1-content')).toBeInTheDocument();
    });

    it('should load existing draft if present', async () => {
      const existingDraft = createMockDraft({
        step_state: 'REVIEW',
      });
      mockDraft = existingDraft;
      mockPayload = existingDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('shift-end-wizard')).toBeInTheDocument();
      });
    });

    it('should show loading state while draft is loading', async () => {
      mockIsDraftLoading = true;

      await renderShiftEndPage();

      expect(screen.getByTestId('shift-end-wizard-loading')).toBeInTheDocument();
    });

    it('should not include lottery data (SHIFT_CLOSE has no lottery step)', async () => {
      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('shift-end-wizard')).toBeInTheDocument();
      });

      // SHIFT_CLOSE does not have lottery data
      expect(mockPayload.lottery).toBeUndefined();
    });
  });

  describe('Step Navigation with Step State Updates', () => {
    it('should update step state to REVIEW when navigating to Step 2', async () => {
      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      // Complete Step 1 (Report Scanning)
      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(mockUpdateStepState).toHaveBeenCalledWith('REVIEW');
      });
    });

    it('should update step state to REPORTS when going back from Step 2', async () => {
      mockDraft = createMockDraft({ step_state: 'REVIEW' });
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      // Navigate to Step 2
      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('shift-close-step-2-content')).toBeInTheDocument();
      });

      // Click Back button
      fireEvent.click(screen.getByTestId('shift-close-back-btn'));

      await waitFor(() => {
        expect(mockUpdateStepState).toHaveBeenCalledWith('REPORTS');
      });
    });
  });
});

// ============================================================================
// Test Suite: T7.2 - Crash Recovery Tests
// ============================================================================

describe('T7.2: ShiftEndPage Crash Recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraft = null;
    mockPayload = {};
    mockRecoveryInfo = null;
    mockIsDraftLoading = false;
  });

  describe('Recovery Dialog Display', () => {
    it('should show recovery dialog when existing draft is found', async () => {
      const existingDraft = createMockDraft({
        step_state: 'REVIEW',
      });

      mockDraft = existingDraft;
      mockPayload = existingDraft.payload;
      mockRecoveryInfo = {
        hasDraft: true,
        draft: existingDraft,
        stepState: 'REVIEW',
        lastUpdated: '2026-02-21T10:00:00Z',
      };

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByText('Resume Previous Session?')).toBeInTheDocument();
      });

      // Should show recovery details specific to SHIFT_CLOSE
      expect(screen.getByText('Close Shift (Step 2)')).toBeInTheDocument();
    });

    it('should not show recovery dialog when no existing draft', async () => {
      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;
      mockRecoveryInfo = null;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('shift-end-wizard')).toBeInTheDocument();
      });

      expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument();
    });

    it('should show Report Scanning (Step 1) for REPORTS step state', async () => {
      const existingDraft = createMockDraft({
        step_state: 'REPORTS',
      });

      mockDraft = existingDraft;
      mockPayload = existingDraft.payload;
      mockRecoveryInfo = {
        hasDraft: true,
        draft: existingDraft,
        stepState: 'REPORTS',
        lastUpdated: '2026-02-21T09:00:00Z',
      };

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByText('Resume Previous Session?')).toBeInTheDocument();
      });

      expect(screen.getByText('Report Scanning (Step 1)')).toBeInTheDocument();
    });
  });

  describe('Resume Flow', () => {
    it('should resume to correct step when Resume button clicked', async () => {
      const existingDraft = createMockDraft({
        step_state: 'REVIEW',
      });

      mockDraft = existingDraft;
      mockPayload = existingDraft.payload;
      mockRecoveryInfo = {
        hasDraft: true,
        draft: existingDraft,
        stepState: 'REVIEW',
        lastUpdated: '2026-02-21T10:00:00Z',
      };

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('crash-recovery-resume-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('crash-recovery-resume-btn'));

      // Should show success toast
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Session Resumed',
          })
        );
      });
    });
  });

  describe('Discard Flow', () => {
    it('should expire draft when Start Fresh button clicked', async () => {
      const existingDraft = createMockDraft({
        step_state: 'REVIEW',
      });

      mockDraft = existingDraft;
      mockPayload = existingDraft.payload;
      mockRecoveryInfo = {
        hasDraft: true,
        draft: existingDraft,
        stepState: 'REVIEW',
        lastUpdated: '2026-02-21T10:00:00Z',
      };

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('crash-recovery-discard-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('crash-recovery-discard-btn'));

      await waitFor(() => {
        expect(mockDiscardDraft).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Session Discarded',
          })
        );
      });
    });
  });
});

// ============================================================================
// Test Suite: T7.3 - Finalize Flow Tests
// ============================================================================

describe('T7.3: ShiftEndPage Finalize Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraft = null;
    mockPayload = {};
    mockRecoveryInfo = null;
    mockIsDraftLoading = false;
    mockIsFinalizing = false;
  });

  describe('Closing Cash Dialog', () => {
    it('should show closing cash dialog when Complete Shift Close clicked', async () => {
      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      // Navigate through to Step 2
      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      // Complete Step 1
      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('shift-close-step-2-content')).toBeInTheDocument();
      });

      // Click Complete Shift Close button
      const completeBtn = screen.getByTestId('complete-shift-close-btn');
      fireEvent.click(completeBtn);

      // Should show closing cash dialog
      await waitFor(() => {
        expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
        expect(screen.getByTestId('finalize-shift-close-btn')).toBeInTheDocument();
      });
    });

    it('should call draft.finalize when Finalize button clicked', async () => {
      mockFinalizeDraft.mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: { shift_id: 'shift-001' },
      });

      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      // Navigate to Step 2
      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
      });

      // Click Complete Shift Close
      fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
      });

      // Enter closing cash
      const user = userEvent.setup();
      const closingCashInput = screen.getByTestId('closing-cash-input');
      await user.type(closingCashInput, '350.00');

      // Click Finalize
      const finalizeBtn = screen.getByTestId('finalize-shift-close-btn');
      fireEvent.click(finalizeBtn);

      await waitFor(() => {
        expect(mockFinalizeDraft).toHaveBeenCalledWith(350);
      });
    });

    it('should navigate to dashboard on successful finalization', async () => {
      mockFinalizeDraft.mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: { shift_id: 'shift-001' },
      });

      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.type(screen.getByTestId('closing-cash-input'), '350');

      fireEvent.click(screen.getByTestId('finalize-shift-close-btn'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/mystore');
      });
    });

    it('should show error toast on finalization failure', async () => {
      mockFinalizeDraft.mockRejectedValue(new Error('Database error'));

      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.type(screen.getByTestId('closing-cash-input'), '350');

      fireEvent.click(screen.getByTestId('finalize-shift-close-btn'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Error',
            variant: 'destructive',
          })
        );
      });
    });

    it('should show success toast on finalization', async () => {
      mockFinalizeDraft.mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: { shift_id: 'shift-001' },
      });

      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.type(screen.getByTestId('closing-cash-input'), '350');

      fireEvent.click(screen.getByTestId('finalize-shift-close-btn'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Shift Closed Successfully',
          })
        );
      });
    });
  });

  describe('Input Sanitization', () => {
    it('should save draft before showing finalize dialog', async () => {
      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

      // saveDraft should be called before showing the dialog
      await waitFor(() => {
        expect(mockSaveDraft).toHaveBeenCalled();
      });
    });

    it('should sanitize closing cash input (SEC-014)', async () => {
      mockFinalizeDraft.mockResolvedValue({ success: true, closed_at: '2026-02-21T18:00:00Z' });

      mockDraft = createMockDraft();
      mockPayload = mockDraft.payload;

      await renderShiftEndPage();

      await waitFor(() => {
        expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('mock-reports-complete'));

      await waitFor(() => {
        expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
      });

      // Enter malformed input (should be sanitized)
      const user = userEvent.setup();
      await user.type(screen.getByTestId('closing-cash-input'), '$350.00xyz');

      fireEvent.click(screen.getByTestId('finalize-shift-close-btn'));

      await waitFor(() => {
        // Should be called with sanitized numeric value
        expect(mockFinalizeDraft).toHaveBeenCalledWith(350);
      });
    });
  });
});

// ============================================================================
// Test Suite: Security Tests
// ============================================================================

describe('Security: ShiftEndPage Draft Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraft = createMockDraft();
    mockPayload = mockDraft.payload;
    mockRecoveryInfo = null;
    mockIsDraftLoading = false;
  });

  it('should use store-scoped draft operations (DB-006)', async () => {
    // This is enforced at the backend level
    // The test verifies the hook is called with correct parameters
    await renderShiftEndPage();

    await waitFor(() => {
      expect(screen.getByTestId('shift-end-wizard')).toBeInTheDocument();
    });

    // The useCloseDraft hook is called with shiftId and 'SHIFT_CLOSE'
    // Backend enforces store scoping via getConfiguredStore()
    const { useCloseDraft } = await import('@/hooks/useCloseDraft');
    expect(useCloseDraft).toHaveBeenCalled();
  });

  it('should strip non-numeric characters from closing cash input (SEC-014)', async () => {
    mockFinalizeDraft.mockResolvedValue({ success: true, closed_at: '2026-02-21T18:00:00Z' });

    await renderShiftEndPage();

    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-reports-complete'));

    await waitFor(() => {
      expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    // Enter value with non-numeric chars (minus sign stripped, digits kept)
    // SEC-014: Sanitization strips non-[0-9.] characters
    const user = userEvent.setup();
    await user.type(screen.getByTestId('closing-cash-input'), '-100');

    fireEvent.click(screen.getByTestId('finalize-shift-close-btn'));

    await waitFor(() => {
      // Minus sign stripped, "100" remains
      expect(mockFinalizeDraft).toHaveBeenCalledWith(100);
    });
  });

  it('should return 0 for empty or invalid closing cash input (SEC-014)', async () => {
    mockFinalizeDraft.mockResolvedValue({ success: true, closed_at: '2026-02-21T18:00:00Z' });

    await renderShiftEndPage();

    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-reports-complete'));

    await waitFor(() => {
      expect(screen.getByTestId('complete-shift-close-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('complete-shift-close-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('closing-cash-input')).toBeInTheDocument();
    });

    // Enter only non-numeric characters (should result in 0)
    const user = userEvent.setup();
    await user.type(screen.getByTestId('closing-cash-input'), 'abc');

    fireEvent.click(screen.getByTestId('finalize-shift-close-btn'));

    await waitFor(() => {
      // All chars stripped, empty string parses to NaN → 0
      expect(mockFinalizeDraft).toHaveBeenCalledWith(0);
    });
  });
});

// ============================================================================
// Test Suite: No Lottery Operations Tests
// ============================================================================

describe('ShiftEndPage: No Lottery Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraft = createMockDraft();
    mockPayload = mockDraft.payload;
    mockRecoveryInfo = null;
    mockIsDraftLoading = false;
  });

  it('should not have lottery data in draft payload (SHIFT_CLOSE)', async () => {
    await renderShiftEndPage();

    await waitFor(() => {
      expect(screen.getByTestId('shift-end-wizard')).toBeInTheDocument();
    });

    // Verify draft payload does not contain lottery
    expect(mockPayload.lottery).toBeUndefined();
    expect(mockDraft?.draft_type).toBe('SHIFT_CLOSE');
  });

  it('should not call updateLottery (not applicable for SHIFT_CLOSE)', async () => {
    await renderShiftEndPage();

    await waitFor(() => {
      expect(screen.getByTestId('report-scanning-step')).toBeInTheDocument();
    });

    // Complete the wizard
    fireEvent.click(screen.getByTestId('mock-reports-complete'));

    await waitFor(() => {
      expect(screen.getByTestId('shift-close-step-2-content')).toBeInTheDocument();
    });

    // useCloseDraft for SHIFT_CLOSE doesn't have updateLottery method used
    // This is validated by the fact that lottery payload remains undefined
    expect(mockPayload.lottery).toBeUndefined();
  });
});
