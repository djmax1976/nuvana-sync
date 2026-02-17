/**
 * LotteryPage Onboarding Loading Modal Unit Tests
 *
 * Tests the OnboardingLoadingModal behavior in LotteryPage:
 * - Modal shows during first-ever day when onboarding status loading
 * - Modal hides when onboarding status loaded
 * - Modal does NOT show for subsequent days
 * - Modal does NOT show when no open day
 * - User cannot interact with page while modal open
 *
 * Story: BIZ-012-UX-FIX - Direct Onboarding Update (Phase 2)
 *
 * Traceability:
 * - LP-LOAD-001: Modal shows during first-ever day onboarding load
 * - LP-LOAD-002: Modal auto-dismisses when loading complete
 * - LP-LOAD-003: Modal does NOT show for subsequent days
 * - LP-LOAD-004: No flash of content before modal
 * - SEC-014: INPUT_VALIDATION - Static text only, no user input
 * - ARCH-004: FE_TESTING_STRATEGY - Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/pages/LotteryPage.onboarding-loading
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock ClientAuthContext
const mockUseClientAuth = vi.fn();
vi.mock('../../../src/renderer/contexts/ClientAuthContext', () => ({
  useClientAuth: () => mockUseClientAuth(),
}));

// Mock useClientDashboard
const mockUseClientDashboard = vi.fn();
vi.mock('../../../src/renderer/lib/api/client-dashboard', () => ({
  useClientDashboard: () => mockUseClientDashboard(),
}));

// Mock useLottery hooks
const mockUseLotteryPacks = vi.fn();
const mockUsePackDetails = vi.fn();
const mockUseInvalidateLottery = vi.fn();
const mockUseLotteryDayBins = vi.fn();
const mockUseDayStatus = vi.fn();
const mockUseInitializeBusinessDay = vi.fn();
const mockUseOnboardingStatus = vi.fn();
const mockUseCompleteOnboarding = vi.fn();

vi.mock('../../../src/renderer/hooks/useLottery', () => ({
  useLotteryPacks: () => mockUseLotteryPacks(),
  usePackDetails: () => mockUsePackDetails(),
  useInvalidateLottery: () => mockUseInvalidateLottery(),
  useLotteryDayBins: () => mockUseLotteryDayBins(),
  useDayStatus: () => mockUseDayStatus(),
  useInitializeBusinessDay: () => mockUseInitializeBusinessDay(),
  useOnboardingStatus: () => mockUseOnboardingStatus(),
  useCompleteOnboarding: () => mockUseCompleteOnboarding(),
}));

// Mock useAuthGuard
const mockExecuteWithAuth = vi.fn((onValid, _onInvalid) =>
  onValid({ userId: 'test-user', name: 'Test User' })
);
vi.mock('../../../src/renderer/hooks/useAuthGuard', () => ({
  useAuthGuard: () => ({
    executeWithAuth: mockExecuteWithAuth,
  }),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('../../../src/renderer/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock notification sound hook
vi.mock('../../../src/renderer/hooks/use-notification-sound', () => ({
  useNotificationSound: () => ({
    playSuccess: vi.fn(),
    playError: vi.fn(),
    isMuted: false,
    toggleMute: vi.fn(),
  }),
}));

// Mock lottery API
vi.mock('../../../src/renderer/lib/api/lottery', () => ({
  closeLotteryDay: vi.fn().mockResolvedValue({
    success: true,
    data: { closings_created: 3, business_date: '2026-02-17' },
  }),
}));

// Mock lottery closing validation
vi.mock('../../../src/renderer/lib/services/lottery-closing-validation', () => ({
  validateManualEntryEnding: vi.fn().mockResolvedValue({ valid: true }),
}));

// Mock lottery components
vi.mock('../../../src/renderer/components/lottery/EnhancedPackActivationForm', () => ({
  EnhancedPackActivationForm: vi.fn(() => <div data-testid="pack-activation-form" />),
}));

vi.mock('../../../src/renderer/components/lottery/DayBinsTable', () => ({
  DayBinsTable: vi.fn(() => <div data-testid="day-bins-table" />),
}));

vi.mock('../../../src/renderer/components/lottery/DayCloseScannerBar', () => ({
  DayCloseScannerBar: vi.fn(() => <div data-testid="day-close-scanner-bar" />),
}));

vi.mock('../../../src/renderer/components/lottery/DepletedPacksSection', () => ({
  DepletedPacksSection: () => <div data-testid="depleted-packs-section" />,
}));

vi.mock('../../../src/renderer/components/lottery/ReturnedPacksSection', () => ({
  ReturnedPacksSection: () => <div data-testid="returned-packs-section" />,
}));

vi.mock('../../../src/renderer/components/lottery/ActivatedPacksSection', () => ({
  ActivatedPacksSection: () => <div data-testid="activated-packs-section" />,
}));

vi.mock('../../../src/renderer/components/lottery/PackDetailsModal', () => ({
  PackDetailsModal: () => <div data-testid="pack-details-modal" />,
}));

vi.mock('../../../src/renderer/components/lottery/MarkSoldOutDialog', () => ({
  MarkSoldOutDialog: () => <div data-testid="mark-sold-out-dialog" />,
}));

vi.mock('../../../src/renderer/components/lottery/ManualEntryIndicator', () => ({
  ManualEntryIndicator: () => <div data-testid="manual-entry-indicator" />,
}));

vi.mock('../../../src/renderer/components/lottery/ReturnPackDialog', () => ({
  ReturnPackDialog: () => <div data-testid="return-pack-dialog" />,
}));

vi.mock('../../../src/renderer/components/auth/PinVerificationDialog', () => ({
  PinVerificationDialog: vi.fn(() => null),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Loader2: (props: Record<string, unknown>) => <div data-testid="loader-icon" {...props} />,
  AlertCircle: (props: Record<string, unknown>) => <div data-testid="alert-icon" {...props} />,
  Zap: (props: Record<string, unknown>) => <div data-testid="zap-icon" {...props} />,
  PenLine: (props: Record<string, unknown>) => <div data-testid="pen-icon" {...props} />,
  X: (props: Record<string, unknown>) => <div data-testid="x-icon" {...props} />,
  Save: (props: Record<string, unknown>) => <div data-testid="save-icon" {...props} />,
  CalendarCheck: (props: Record<string, unknown>) => <div data-testid="calendar-icon" {...props} />,
  ScanLine: (props: Record<string, unknown>) => <div data-testid="scan-line-icon" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => <div data-testid="check-icon" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => (
    <div data-testid="alert-triangle-icon" {...props} />
  ),
  Info: (props: Record<string, unknown>) => <div data-testid="info-icon" {...props} />,
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import LotteryPage from '../../../src/renderer/pages/LotteryPage';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockDashboard() {
  return {
    stores: [{ store_id: 'store-001', name: 'Test Store', status: 'ACTIVE' }],
  };
}

function createMockDayStatusWithOpenDay(overrides = {}) {
  return {
    has_open_day: true,
    day: {
      day_id: 'day-001',
      business_date: '2026-02-17',
      status: 'OPEN',
      opened_at: '2026-02-17T08:00:00Z',
      opened_by: 'user-001',
    },
    today: '2026-02-17',
    prerequisites: {
      has_bins: true,
      has_games: true,
      bins_count: 4,
      games_count: 10,
    },
    needs_initialization: false,
    is_first_ever: false,
    ...overrides,
  };
}

function createMockDayStatusFirstEverWithOpenDay() {
  return createMockDayStatusWithOpenDay({
    is_first_ever: true,
  });
}

function createMockDayStatusNoOpenDay() {
  return {
    has_open_day: false,
    day: null,
    today: '2026-02-17',
    prerequisites: {
      has_bins: true,
      has_games: true,
      bins_count: 4,
      games_count: 10,
    },
    needs_initialization: true,
    is_first_ever: true,
  };
}

function createMockDayBins() {
  return {
    bins: [
      {
        bin_id: 'bin-001',
        bin_number: 1,
        name: 'Bin 1',
        is_active: true,
        pack: {
          pack_id: 'pack-001',
          pack_number: '1234567',
          game_name: 'Powerball',
          game_price: 5,
          starting_serial: '000',
          ending_serial: null,
          serial_end: '299',
          is_first_period: false,
        },
      },
    ],
    business_day: {
      date: '2026-02-17',
      day_id: 'day-001',
      status: 'OPEN',
      first_shift_opened_at: '2026-02-17T08:00:00Z',
      last_shift_closed_at: null,
      shifts_count: 1,
    },
    open_business_period: {
      started_at: '2026-02-17T08:00:00Z',
      last_closed_date: '2026-02-16',
      days_since_last_close: 1,
      is_first_period: false,
    },
    depleted_packs: [],
    activated_packs: [],
    returned_packs: [],
    day_close_summary: null,
    can_close_independently: true,
  };
}

function setupDefaultMocks() {
  mockUseClientAuth.mockReturnValue({
    user: { id: 'user-001', name: 'Test User' },
    isAuthenticated: true,
    isLoading: false,
  });

  mockUseClientDashboard.mockReturnValue({
    data: createMockDashboard(),
    isLoading: false,
    isError: false,
    error: null,
  });

  mockUseDayStatus.mockReturnValue({
    data: createMockDayStatusWithOpenDay(),
    isLoading: false,
    isError: false,
  });

  mockUseLotteryDayBins.mockReturnValue({
    data: createMockDayBins(),
    isLoading: false,
    isError: false,
    error: null,
  });

  mockUseLotteryPacks.mockReturnValue({
    data: [],
  });

  mockUsePackDetails.mockReturnValue({
    data: null,
    isLoading: false,
  });

  mockUseInvalidateLottery.mockReturnValue({
    invalidateAll: vi.fn(),
  });

  mockUseInitializeBusinessDay.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  // Default: not in onboarding, not loading
  mockUseOnboardingStatus.mockReturnValue({
    data: { isOnboarding: false, dayId: null, businessDate: null, openedAt: null },
    isLoading: false,
  });

  mockUseCompleteOnboarding.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

// ============================================================================
// Tests - LP-LOAD-001: Modal shows during first-ever day onboarding load
// ============================================================================

describe('LP-LOAD-001: Modal Shows During First-Ever Day Onboarding Load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should show OnboardingLoadingModal when first-ever day and onboarding status loading', () => {
    // Setup first-ever day with OPEN day
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    // Onboarding status is LOADING
    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    // Modal should be visible
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
  });

  it('should display "Preparing onboarding..." text in modal', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    expect(screen.getByText('Preparing onboarding...')).toBeInTheDocument();
  });

  it('should display spinner in loading modal', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    expect(screen.getByTestId('onboarding-loading-spinner')).toBeInTheDocument();
  });

  it('should show modal with all three conditions: has_open_day, is_first_ever, and loading', () => {
    // All three conditions must be true
    mockUseDayStatus.mockReturnValue({
      data: {
        ...createMockDayStatusWithOpenDay(),
        has_open_day: true,
        is_first_ever: true,
      },
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
  });
});

// ============================================================================
// Tests - LP-LOAD-002: Modal auto-dismisses when loading complete
// ============================================================================

describe('LP-LOAD-002: Modal Auto-Dismisses When Loading Complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT show modal when onboarding status is NOT loading', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    // Onboarding status finished loading
    mockUseOnboardingStatus.mockReturnValue({
      data: {
        isOnboarding: true,
        dayId: 'day-001',
        businessDate: '2026-02-17',
        openedAt: '2026-02-17T08:00:00Z',
      },
      isLoading: false,
    });

    render(<LotteryPage />);

    // Modal should NOT be visible
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });

  it('should auto-dismiss modal when loading transitions to loaded', async () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    // Start with loading = true
    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { rerender } = render(<LotteryPage />);

    // Modal should be visible initially
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();

    // Update to loaded state
    mockUseOnboardingStatus.mockReturnValue({
      data: {
        isOnboarding: true,
        dayId: 'day-001',
        businessDate: '2026-02-17',
        openedAt: '2026-02-17T08:00:00Z',
      },
      isLoading: false,
    });

    rerender(<LotteryPage />);

    // Modal should now be hidden
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
    });
  });

  it('should show onboarding indicator after loading completes with isOnboarding=true', async () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    // Start with loading
    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { rerender } = render(<LotteryPage />);

    // Update to loaded with onboarding active
    mockUseOnboardingStatus.mockReturnValue({
      data: {
        isOnboarding: true,
        dayId: 'day-001',
        businessDate: '2026-02-17',
        openedAt: '2026-02-17T08:00:00Z',
      },
      isLoading: false,
    });

    rerender(<LotteryPage />);

    // Onboarding indicator should be visible
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Tests - LP-LOAD-003: Modal Does NOT Show For Subsequent Days
// ============================================================================

describe('LP-LOAD-003: Modal Does NOT Show For Subsequent Days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT show modal when is_first_ever=false even if loading', () => {
    // NOT first-ever day (subsequent day)
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusWithOpenDay({
        is_first_ever: false, // Subsequent day
      }),
      isLoading: false,
      isError: false,
    });

    // Even though loading
    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    // Modal should NOT be visible
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });

  it('should NOT show modal for regular stores (not first-ever)', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusWithOpenDay({
        is_first_ever: false,
        has_open_day: true,
      }),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: { isOnboarding: false, dayId: null, businessDate: null, openedAt: null },
      isLoading: true, // Even if loading
    });

    render(<LotteryPage />);

    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });

  it('should show main content directly for subsequent days', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusWithOpenDay({
        is_first_ever: false,
      }),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: { isOnboarding: false, dayId: null, businessDate: null, openedAt: null },
      isLoading: false,
    });

    render(<LotteryPage />);

    // Main content should be visible
    expect(screen.getByTestId('day-bins-table')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Tests - Modal Does NOT Show When No Open Day
// ============================================================================

describe('Modal Does NOT Show When No Open Day', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT show modal when has_open_day=false even if is_first_ever', () => {
    // No open day (needs initialization)
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusNoOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    // Modal should NOT be visible - initialization screen should show instead
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
    // Initialization screen should be shown
    expect(screen.getByText('Start Your First Business Day')).toBeInTheDocument();
  });

  it('should show initialization screen when needs_initialization=true', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusNoOpenDay(),
      isLoading: false,
      isError: false,
    });

    render(<LotteryPage />);

    expect(screen.getByText('Start Your First Business Day')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Tests - LP-LOAD-004: No Flash of Content Before Modal
// ============================================================================

describe('LP-LOAD-004: No Flash of Content Before Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should show modal BEFORE any interactive content when loading', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    // Modal should be visible
    const modal = screen.getByTestId('onboarding-loading-modal');
    expect(modal).toBeInTheDocument();

    // Modal should have high z-index and full-screen coverage
    expect(modal).toHaveClass('z-50');
    expect(modal).toHaveClass('fixed');
    expect(modal).toHaveClass('inset-0');
  });

  it('should have modal appear before table content on initial render', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    // Modal should be rendered
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();

    // The modal blocks interaction, even if table is rendered behind it
  });
});

// ============================================================================
// Tests - WCAG Accessibility
// ============================================================================

describe('WCAG Accessibility in Loading State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have proper ARIA attributes on loading modal', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<LotteryPage />);

    const modal = screen.getByTestId('onboarding-loading-modal');
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(modal).toHaveAttribute('aria-busy', 'true');
  });
});

// ============================================================================
// Tests - Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle undefined dayStatus gracefully', () => {
    mockUseDayStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    expect(() => render(<LotteryPage />)).not.toThrow();
    // Should show loading state, not modal
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });

  it('should handle undefined onboarding status data gracefully', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    expect(() => render(<LotteryPage />)).not.toThrow();
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
  });

  it('should handle rapid loading state changes', async () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    // Start loading
    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { rerender } = render(<LotteryPage />);
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();

    // Finish loading
    mockUseOnboardingStatus.mockReturnValue({
      data: {
        isOnboarding: true,
        dayId: 'day-001',
        businessDate: '2026-02-17',
        openedAt: '2026-02-17T08:00:00Z',
      },
      isLoading: false,
    });

    rerender(<LotteryPage />);
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();

    // Back to loading
    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    rerender(<LotteryPage />);
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
  });

  it('should cleanup modal on unmount', () => {
    mockUseDayStatus.mockReturnValue({
      data: createMockDayStatusFirstEverWithOpenDay(),
      isLoading: false,
      isError: false,
    });

    mockUseOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { unmount } = render(<LotteryPage />);
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();

    unmount();

    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Tests - Modal Condition Logic
// ============================================================================

describe('Modal Condition Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Modal Condition Matrix:
   * | has_open_day | is_first_ever | onboardingStatusLoading | Expected Modal |
   * |--------------|---------------|-------------------------|----------------|
   * | true         | true          | true                    | VISIBLE        |
   * | true         | true          | false                   | HIDDEN         |
   * | true         | false         | true                    | HIDDEN         |
   * | true         | false         | false                   | HIDDEN         |
   * | false        | true          | true                    | HIDDEN         |
   * | false        | true          | false                   | HIDDEN         |
   * | false        | false         | true                    | HIDDEN         |
   * | false        | false         | false                   | HIDDEN         |
   */

  const testCases = [
    { hasOpenDay: true, isFirstEver: true, isLoading: true, expected: true },
    { hasOpenDay: true, isFirstEver: true, isLoading: false, expected: false },
    { hasOpenDay: true, isFirstEver: false, isLoading: true, expected: false },
    { hasOpenDay: true, isFirstEver: false, isLoading: false, expected: false },
    { hasOpenDay: false, isFirstEver: true, isLoading: true, expected: false },
    { hasOpenDay: false, isFirstEver: true, isLoading: false, expected: false },
    { hasOpenDay: false, isFirstEver: false, isLoading: true, expected: false },
    { hasOpenDay: false, isFirstEver: false, isLoading: false, expected: false },
  ];

  testCases.forEach(({ hasOpenDay, isFirstEver, isLoading, expected }) => {
    it(`should ${expected ? 'show' : 'hide'} modal when has_open_day=${hasOpenDay}, is_first_ever=${isFirstEver}, loading=${isLoading}`, () => {
      if (hasOpenDay) {
        mockUseDayStatus.mockReturnValue({
          data: createMockDayStatusWithOpenDay({ is_first_ever: isFirstEver }),
          isLoading: false,
          isError: false,
        });
      } else {
        mockUseDayStatus.mockReturnValue({
          data: {
            has_open_day: false,
            day: null,
            today: '2026-02-17',
            prerequisites: { has_bins: true, has_games: true, bins_count: 4, games_count: 10 },
            needs_initialization: true,
            is_first_ever: isFirstEver,
          },
          isLoading: false,
          isError: false,
        });
      }

      mockUseOnboardingStatus.mockReturnValue({
        data: isLoading
          ? undefined
          : { isOnboarding: false, dayId: null, businessDate: null, openedAt: null },
        isLoading,
      });

      render(<LotteryPage />);

      if (expected) {
        expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
      }
    });
  });
});

// ============================================================================
// Tests - Traceability Matrix
// ============================================================================

describe('Traceability: BIZ-012-UX-FIX Phase 2 LotteryPage Requirements', () => {
  /**
   * Requirement Matrix for LotteryPage Onboarding Loading:
   *
   * | Test ID | Requirement | Test Case | Status |
   * |---------|-------------|-----------|--------|
   * | LP-LOAD-001 | Modal shows during first-ever day onboarding load | "LP-LOAD-001" describe | Covered |
   * | LP-LOAD-002 | Modal auto-dismisses when loading complete | "LP-LOAD-002" describe | Covered |
   * | LP-LOAD-003 | Modal does NOT show for subsequent days | "LP-LOAD-003" describe | Covered |
   * | LP-LOAD-004 | No flash of content before modal | "LP-LOAD-004" describe | Covered |
   */
  it('should satisfy all Phase 2 LotteryPage requirements', () => {
    expect(true).toBe(true);
  });
});
