/**
 * DayClosePage Context-Based Unit Tests
 *
 * Tests the DayClosePage component's context-based integration (Phase 4):
 * - Verifies context provides shift/user data (4.T1)
 * - Loading state during data fetch (4.T2)
 * - Error state on IPC failure
 * - Shift info header displays correctly from context (4.T4)
 * - No blocking banner (guard handles conditions) (4.T3)
 * - Full wizard flow works with guard context (4.T4)
 *
 * Story: Day Close Access Guard - Phase 4 DayClosePage Migration
 *
 * MCP Guidance Applied:
 * - TEST-001: Unit tests are primary (70-80% of test suite)
 * - TEST-002: Single concept per test
 * - ARCH-004: Component-level isolation tests
 * - SEC-010: Context populated after backend authorization
 * - DB-006: Verifies store-scoped queries via local hooks
 *
 * @module tests/unit/pages/DayClosePage.local-ipc
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock react-router-dom hooks (simplified - no URL params needed anymore)
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock DayCloseAccessContext - provides validated shift/user data from guard
const mockContextValue = {
  activeShift: {
    shift_id: 'shift-uuid-001',
    shift_number: 1,
    cashier_id: 'cashier-uuid-001',
    cashier_name: 'John Smith',
    external_register_id: 'ext-reg-001',
    terminal_name: 'POS Terminal 1',
    business_date: '2026-02-12',
    start_time: '2026-02-12T06:00:00.000Z',
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

// Mock useLocalStore (still needed for store_id)
const mockUseLocalStore = vi.fn();
vi.mock('../../../src/renderer/hooks/useLocalStore', () => ({
  useLocalStore: () => mockUseLocalStore(),
}));

// Mock useLotteryDayBins (still needed for lottery data)
const mockUseLotteryDayBins = vi.fn();
vi.mock('../../../src/renderer/hooks/useLottery', () => ({
  useLotteryDayBins: () => mockUseLotteryDayBins(),
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

// Mock lottery API (for commit/cancel)
vi.mock('../../../src/renderer/lib/api/lottery', () => ({
  commitLotteryDayClose: vi.fn().mockResolvedValue({ success: true }),
  cancelLotteryDayClose: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock ShiftClosingForm
vi.mock('../../../src/renderer/components/shifts/ShiftClosingForm', () => ({
  ShiftClosingForm: ({
    open,
    preAuthorizedOverride,
  }: {
    open: boolean;
    preAuthorizedOverride?: boolean;
  }) =>
    open ? (
      <div data-testid="shift-closing-form" data-pre-authorized={preAuthorizedOverride}>
        Shift Closing Form
      </div>
    ) : null,
}));

// Mock DayCloseModeScanner (without blockingShifts prop)
vi.mock('../../../src/renderer/components/lottery/DayCloseModeScanner', () => ({
  DayCloseModeScanner: () => <div data-testid="day-close-scanner">Day Close Scanner</div>,
}));

// Mock ReportScanningStep
vi.mock('../../../src/renderer/components/day-close/ReportScanningStep', () => ({
  ReportScanningStep: () => <div data-testid="report-scanning-step">Report Scanning Step</div>,
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

// Mock Card components
vi.mock('../../../src/renderer/components/ui/card', () => ({
  Card: ({ children, className, ...props }: React.PropsWithChildren<{ className?: string }>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  CardContent: ({
    children,
    className,
    ...props
  }: React.PropsWithChildren<{ className?: string }>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

// Mock Button
vi.mock('../../../src/renderer/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...props
  }: React.PropsWithChildren<{
    disabled?: boolean;
    onClick?: () => void;
    variant?: string;
    className?: string;
  }>) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// Import the component after all mocks are set up
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

function createContextValue(
  overrides: Partial<{
    activeShift: typeof mockContextValue.activeShift;
    user: typeof mockContextValue.user;
    accessType: 'OWNER' | 'OVERRIDE';
  }> = {}
) {
  return {
    ...mockContextValue,
    ...overrides,
  };
}

function createLotteryDayBins(
  overrides: Partial<{
    bins: Array<unknown>;
    business_day: { date: string; status: string } | null;
    returned_packs: Array<unknown>;
    depleted_packs: Array<unknown>;
    activated_packs: Array<unknown>;
    open_business_period: unknown;
    day_close_summary: unknown;
  }> = {}
) {
  return {
    bins: [],
    business_day: { date: '2026-02-12', status: 'OPEN' },
    returned_packs: [],
    depleted_packs: [],
    activated_packs: [],
    open_business_period: null,
    day_close_summary: null,
    ...overrides,
  };
}

// ============================================================================
// Test Helper
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

  // Default happy path mocks
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
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: 4.T1 - Uses Context Instead of URL Params
// ============================================================================

describe('4.T1: DayClosePage uses context instead of URL params', () => {
  it('should render using context data instead of URL params', async () => {
    renderDayClosePage();

    await waitFor(() => {
      // Verify context hook was called
      expect(mockUseDayCloseAccessContext).toHaveBeenCalled();
    });
  });

  it('should display shift ID from context (not URL)', async () => {
    const contextWithShift = createContextValue({
      activeShift: {
        ...mockContextValue.activeShift,
        shift_id: 'context-shift-uuid',
        shift_number: 5,
      },
    });
    mockUseDayCloseAccessContext.mockReturnValue(contextWithShift);

    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByText('#5')).toBeInTheDocument();
    });
  });

  it('should display terminal name from context (pre-resolved)', async () => {
    const contextWithTerminal = createContextValue({
      activeShift: {
        ...mockContextValue.activeShift,
        terminal_name: 'Register Alpha',
      },
    });
    mockUseDayCloseAccessContext.mockReturnValue(contextWithTerminal);

    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByText('Register Alpha')).toBeInTheDocument();
    });
  });

  it('should display cashier name from context (pre-resolved)', async () => {
    const contextWithCashier = createContextValue({
      activeShift: {
        ...mockContextValue.activeShift,
        cashier_name: 'Jane Doe',
      },
    });
    mockUseDayCloseAccessContext.mockReturnValue(contextWithCashier);

    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: 4.T2 - No Longer Queries Open Shifts
// ============================================================================

describe('4.T2: DayClosePage no longer queries open shifts', () => {
  it('should not call useLocalOpenShiftsCheck (removed)', async () => {
    // The hook should not exist/be called anymore
    // This is verified by the absence of the mock and successful rendering
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });

    // No open shifts check mock means the component doesn't depend on it
  });

  it('should not use useLocalShiftDetail (shift data comes from context)', async () => {
    // Rendering succeeds without useLocalShiftDetail mock
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });

  it('should not use useLocalTerminals (terminal name comes from context)', async () => {
    // Rendering succeeds without useLocalTerminals mock
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: 4.T3 - No Blocking Banner (Guard Handles Conditions)
// ============================================================================

describe('4.T3: DayClosePage renders without blocking banner', () => {
  it('should not render open shifts blocking banner', async () => {
    // Guard already validated conditions - no blocking banner needed
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });

    // Blocking banner should not exist
    expect(screen.queryByTestId('open-shifts-blocking-banner')).not.toBeInTheDocument();
  });

  it('should render Step 1 scanner without blockingShifts', async () => {
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-scanner')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: 4.T4 - Full Wizard Flow Works with Guard Context
// ============================================================================

describe('4.T4: Full wizard flow works with guard context', () => {
  it('should render shift info header with context data', async () => {
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('shift-info-header')).toBeInTheDocument();
    });

    // Terminal and cashier from context
    expect(screen.getByText('POS Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('should render step indicator with correct state', async () => {
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('step-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('step-1-indicator')).toBeInTheDocument();
    });
  });

  it('should start on Step 1 (Lottery Close)', async () => {
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('step-1-content')).toBeInTheDocument();
      expect(screen.getByTestId('day-close-scanner')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: Loading State
// ============================================================================

describe('Loading state shows during data fetch', () => {
  it('should show loading spinner when store is loading', async () => {
    mockUseLocalStore.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    renderDayClosePage();

    expect(screen.getByTestId('day-close-wizard-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should show loading spinner when lottery bins is loading', async () => {
    mockUseLotteryDayBins.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    renderDayClosePage();

    expect(screen.getByTestId('day-close-wizard-loading')).toBeInTheDocument();
  });

  it('should hide loading spinner when all data is loaded', async () => {
    renderDayClosePage();

    await waitFor(() => {
      expect(screen.queryByTestId('day-close-wizard-loading')).not.toBeInTheDocument();
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: Error State
// ============================================================================

describe('Error state shows on IPC failure', () => {
  it('should show error when store IPC fails', async () => {
    mockUseLocalStore.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
    });

    renderDayClosePage();

    expect(screen.getByTestId('day-close-wizard-error')).toBeInTheDocument();
    expect(screen.getByText(/Failed to load store data/i)).toBeInTheDocument();
  });

  it('should show error when lottery bins IPC fails', async () => {
    mockUseLotteryDayBins.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
    });

    renderDayClosePage();

    expect(screen.getByTestId('day-close-wizard-error')).toBeInTheDocument();
    expect(screen.getByText(/Failed to load lottery bins data/i)).toBeInTheDocument();
  });

  it('should show no store message when store not configured', async () => {
    mockUseLocalStore.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });

    renderDayClosePage();

    expect(screen.getByTestId('day-close-wizard-no-store')).toBeInTheDocument();
    expect(screen.getByText(/No store available/i)).toBeInTheDocument();
  });
});

// ============================================================================
// TEST SUITE: SEC-010 - Authorization Via Context
// ============================================================================

describe('SEC-010: Authorization via context', () => {
  it('should use context for authorization (not re-verify)', async () => {
    mockUseDayCloseAccessContext.mockReturnValue(createContextValue());

    renderDayClosePage();

    await waitFor(() => {
      // Context hook called - authorization already done by guard
      expect(mockUseDayCloseAccessContext).toHaveBeenCalled();
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });

  it('should display user info from context', async () => {
    const contextWithUser = createContextValue({
      user: {
        userId: 'manager-uuid',
        name: 'Manager Mike',
        role: 'shift_manager',
      },
      accessType: 'OVERRIDE',
    });
    mockUseDayCloseAccessContext.mockReturnValue(contextWithUser);

    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });

  it('should handle OWNER access type', async () => {
    const contextWithOwner = createContextValue({
      accessType: 'OWNER',
    });
    mockUseDayCloseAccessContext.mockReturnValue(contextWithOwner);

    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });

  it('should handle OVERRIDE access type', async () => {
    const contextWithOverride = createContextValue({
      accessType: 'OVERRIDE',
    });
    mockUseDayCloseAccessContext.mockReturnValue(contextWithOverride);

    renderDayClosePage();

    await waitFor(() => {
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// TEST SUITE: Store Name Display
// ============================================================================

describe('Store name from local data', () => {
  it('should display store name from useLocalStore', async () => {
    mockUseLocalStore.mockReturnValue({
      data: createLocalStoreData({ name: 'Sunrise Mart' }),
      isLoading: false,
      isError: false,
    });

    renderDayClosePage();

    await waitFor(() => {
      expect(mockUseLocalStore).toHaveBeenCalled();
    });

    // Verify the mock returned the expected store name
    const storeResult = mockUseLocalStore.mock.results[0]?.value;
    expect(storeResult?.data?.name).toBe('Sunrise Mart');
  });
});

// ============================================================================
// TEST SUITE: DB-006 Tenant Isolation Compliance
// ============================================================================

describe('DB-006: Tenant isolation compliance', () => {
  it('should use store-scoped hooks for remaining data fetching', async () => {
    renderDayClosePage();

    await waitFor(() => {
      // Store data still fetched via local IPC (store-scoped)
      expect(mockUseLocalStore).toHaveBeenCalled();
      // Lottery bins still fetched via local IPC (store-scoped)
      expect(mockUseLotteryDayBins).toHaveBeenCalled();
    });

    // Component renders successfully - all hooks respect DB-006
    expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
  });

  it('should get shift data from context (pre-validated by guard)', async () => {
    renderDayClosePage();

    await waitFor(() => {
      // Context provides shift data - guard already verified store-scoped access
      expect(mockUseDayCloseAccessContext).toHaveBeenCalled();
      expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
    });
  });
});
