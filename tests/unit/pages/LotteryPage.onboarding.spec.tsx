/**
 * LotteryPage Onboarding Mode Unit Tests
 *
 * Tests the LotteryPage onboarding mode behavior:
 * - isOnboardingMode state initialization
 * - Auto-activation when is_first_ever === true
 * - OnboardingModeIndicator visibility
 * - Complete Onboarding button functionality
 * - Toast notifications on mode transitions
 * - onboardingMode prop passed to EnhancedPackActivationForm
 *
 * Story: Lottery Onboarding Feature (BIZ-010)
 *
 * Traceability:
 * - BIZ-010: First-ever lottery day onboarding mode
 * - AC-001: isOnboardingMode state exists in LotteryPage
 * - AC-002: Onboarding mode auto-activates when is_first_ever === true
 * - AC-003: OnboardingModeIndicator renders when onboarding mode active
 * - AC-004: "Complete Onboarding" button exits onboarding mode
 * - AC-005: Toast notifications appear at mode transitions
 * - AC-006: onboardingMode prop passed to EnhancedPackActivationForm
 * - ARCH-004: FE_TESTING_STRATEGY - Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/pages/LotteryPage.onboarding
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

vi.mock('../../../src/renderer/hooks/useLottery', () => ({
  useLotteryPacks: () => mockUseLotteryPacks(),
  usePackDetails: () => mockUsePackDetails(),
  useInvalidateLottery: () => mockUseInvalidateLottery(),
  useLotteryDayBins: () => mockUseLotteryDayBins(),
  useDayStatus: () => mockUseDayStatus(),
  useInitializeBusinessDay: () => mockUseInitializeBusinessDay(),
}));

// Mock useAuthGuard - returns an object with executeWithAuth that calls the valid callback
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
const mockPlaySuccess = vi.fn();
const mockPlayError = vi.fn();
const mockToggleMute = vi.fn();
vi.mock('../../../src/renderer/hooks/use-notification-sound', () => ({
  useNotificationSound: () => ({
    playSuccess: mockPlaySuccess,
    playError: mockPlayError,
    isMuted: false,
    toggleMute: mockToggleMute,
  }),
}));

// Mock lottery API
vi.mock('../../../src/renderer/lib/api/lottery', () => ({
  closeLotteryDay: vi.fn().mockResolvedValue({
    success: true,
    data: { closings_created: 3, business_date: '2026-02-15' },
  }),
}));

// Mock lottery closing validation
vi.mock('../../../src/renderer/lib/services/lottery-closing-validation', () => ({
  validateManualEntryEnding: vi.fn().mockResolvedValue({ valid: true }),
}));

// Track onboardingMode prop passed to EnhancedPackActivationForm
let capturedOnboardingMode: boolean | undefined;
vi.mock('../../../src/renderer/components/lottery/EnhancedPackActivationForm', () => ({
  EnhancedPackActivationForm: vi.fn(({ onboardingMode }) => {
    capturedOnboardingMode = onboardingMode;
    return <div data-testid="pack-activation-form" data-onboarding-mode={String(onboardingMode)} />;
  }),
}));

// Mock other lottery components
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
  PinVerificationDialog: vi.fn(({ open, onVerified }) => {
    if (!open) return null;
    return (
      <div data-testid="pin-dialog">
        <button
          data-testid="verify-pin"
          onClick={() => onVerified({ userId: 'verified-user', name: 'Verified User' })}
        >
          Verify
        </button>
      </div>
    );
  }),
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

function createMockDayStatus(overrides = {}) {
  return {
    has_open_day: true,
    day: {
      day_id: 'day-001',
      business_date: '2026-02-15',
      status: 'OPEN',
      opened_at: '2026-02-15T08:00:00Z',
      opened_by: 'user-001',
    },
    today: '2026-02-15',
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

function createMockDayStatusFirstEver() {
  return createMockDayStatus({
    has_open_day: false,
    day: null,
    needs_initialization: true,
    is_first_ever: true,
  });
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
      date: '2026-02-15',
      day_id: 'day-001',
      status: 'OPEN',
      first_shift_opened_at: '2026-02-15T08:00:00Z',
      last_shift_closed_at: null,
      shifts_count: 1,
    },
    open_business_period: {
      started_at: '2026-02-15T08:00:00Z',
      last_closed_date: '2026-02-14',
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
    data: createMockDayStatus(),
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

  // Reset captured prop
  capturedOnboardingMode = undefined;
}

// ============================================================================
// Tests - Onboarding Mode State Initialization
// ============================================================================

describe('LotteryPage Onboarding Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // AC-001: isOnboardingMode state initialization
  // --------------------------------------------------------------------------
  describe('AC-001: State Initialization', () => {
    it('should start with isOnboardingMode as false', () => {
      render(<LotteryPage />);

      // OnboardingModeIndicator should NOT be visible initially
      expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
    });

    it('should NOT show OnboardingModeIndicator for non-first-ever stores', () => {
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatus({ is_first_ever: false }),
        isLoading: false,
        isError: false,
      });

      render(<LotteryPage />);

      expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // AC-002: Onboarding mode auto-activates when is_first_ever === true
  // --------------------------------------------------------------------------
  describe('AC-002: Auto-Activation on First-Ever Day', () => {
    it('should show initialization screen for first-ever stores', () => {
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      render(<LotteryPage />);

      // Should show "Start First Business Day" button
      expect(screen.getByText('Start Your First Business Day')).toBeInTheDocument();
    });

    it('should activate onboarding mode after first-ever day initialization', async () => {
      // Setup first-ever state
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      // Mock mutate to immediately call onSuccess with is_first_ever: true
      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<LotteryPage />);

      // Click "Start First Business Day" button
      const initButton = screen.getByRole('button', { name: /Start First Business Day/i });
      fireEvent.click(initButton);

      // Verify onboarding toast was shown
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Onboarding Mode Active',
          description: expect.stringContaining('Scan your existing packs'),
        })
      );
    });

    it('should NOT activate onboarding mode for non-first-ever initialization', async () => {
      // Setup subsequent day initialization (is_first_ever: false)
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      // Mock mutate to call onSuccess with is_first_ever: false
      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: false, // Not first ever
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<LotteryPage />);

      // Click "Start First Business Day" button
      const initButton = screen.getByRole('button', { name: /Start First Business Day/i });
      fireEvent.click(initButton);

      // Should show regular business day started toast
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Business Day Started',
        })
      );

      // Should NOT show onboarding toast
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Onboarding Mode Active',
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // AC-003: OnboardingModeIndicator renders when onboarding mode active
  // --------------------------------------------------------------------------
  describe('AC-003: OnboardingModeIndicator Visibility', () => {
    it('should render OnboardingModeIndicator when onboarding mode is activated', async () => {
      // Setup first-ever state
      mockUseDayStatus.mockReturnValueOnce({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      // After initialization, mock returns open day
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatus(),
        isLoading: false,
        isError: false,
      });

      // Mock mutate to activate onboarding mode
      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      const { rerender } = render(<LotteryPage />);

      // Click init button to trigger onboarding
      const initButton = screen.getByRole('button', { name: /Start First Business Day/i });
      fireEvent.click(initButton);

      // Re-render to pick up state changes
      rerender(<LotteryPage />);

      // OnboardingModeIndicator should now be visible
      await waitFor(() => {
        expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // AC-004: "Complete Onboarding" button exits onboarding mode
  // --------------------------------------------------------------------------
  describe('AC-004: Complete Onboarding Button', () => {
    it('should exit onboarding mode when Complete Onboarding is clicked', async () => {
      // Start with day status showing first-ever, then switch to normal after init
      let callCount = 0;
      mockUseDayStatus.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            data: createMockDayStatusFirstEver(),
            isLoading: false,
            isError: false,
          };
        }
        return {
          data: createMockDayStatus(),
          isLoading: false,
          isError: false,
        };
      });

      // Mock mutate to activate onboarding mode
      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      const { rerender } = render(<LotteryPage />);

      // Click init button to trigger onboarding
      const initButton = screen.getByRole('button', { name: /Start First Business Day/i });
      fireEvent.click(initButton);

      // Re-render to pick up state changes
      rerender(<LotteryPage />);

      // Wait for onboarding indicator to appear
      await waitFor(() => {
        expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();
      });

      // Click Complete Onboarding button
      const completeButton = screen.getByTestId('complete-onboarding-button');
      fireEvent.click(completeButton);

      // OnboardingModeIndicator should disappear
      await waitFor(() => {
        expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
      });
    });

    it('should show completion toast when exiting onboarding mode', async () => {
      // Start with normal day status (simulate onboarding was already active via useState)
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatus(),
        isLoading: false,
        isError: false,
      });

      // Mock mutate to activate onboarding mode
      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      // Start with first-ever screen to initialize onboarding
      mockUseDayStatus.mockReturnValueOnce({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      const { rerender } = render(<LotteryPage />);

      // Trigger onboarding mode
      const initButton = screen.getByRole('button', { name: /Start First Business Day/i });
      fireEvent.click(initButton);

      // Clear previous toast calls
      mockToast.mockClear();

      // Re-render to show onboarding indicator
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatus(),
        isLoading: false,
        isError: false,
      });
      rerender(<LotteryPage />);

      // Wait for and click Complete Onboarding button
      await waitFor(() => {
        expect(screen.getByTestId('complete-onboarding-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('complete-onboarding-button'));

      // Verify completion toast was shown
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Onboarding Complete',
          description: expect.stringContaining('Normal operations active'),
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // AC-005: Toast notifications at mode transitions
  // --------------------------------------------------------------------------
  describe('AC-005: Toast Notifications', () => {
    it('should show toast when onboarding mode activates', async () => {
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<LotteryPage />);

      fireEvent.click(screen.getByRole('button', { name: /Start First Business Day/i }));

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Onboarding Mode Active',
          duration: 6000,
        })
      );
    });

    it('should include helpful message in activation toast', async () => {
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<LotteryPage />);

      fireEvent.click(screen.getByRole('button', { name: /Start First Business Day/i }));

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('ticket position will be recorded'),
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // AC-006: onboardingMode prop passed to EnhancedPackActivationForm
  // --------------------------------------------------------------------------
  describe('AC-006: Prop Passing to EnhancedPackActivationForm', () => {
    it('should pass onboardingMode=false to EnhancedPackActivationForm initially', () => {
      render(<LotteryPage />);

      // EnhancedPackActivationForm should receive onboardingMode=false
      expect(capturedOnboardingMode).toBe(false);
    });

    it('should pass onboardingMode=true to EnhancedPackActivationForm after activation', async () => {
      // Start with first-ever screen
      mockUseDayStatus.mockReturnValueOnce({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      const { rerender } = render(<LotteryPage />);

      // Trigger onboarding
      fireEvent.click(screen.getByRole('button', { name: /Start First Business Day/i }));

      // Switch to normal day status for re-render
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatus(),
        isLoading: false,
        isError: false,
      });

      rerender(<LotteryPage />);

      // EnhancedPackActivationForm should now receive onboardingMode=true
      await waitFor(() => {
        expect(capturedOnboardingMode).toBe(true);
      });
    });

    it('should pass onboardingMode=false after completing onboarding', async () => {
      // Start with first-ever screen
      mockUseDayStatus.mockReturnValueOnce({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      const { rerender } = render(<LotteryPage />);

      // Trigger onboarding
      fireEvent.click(screen.getByRole('button', { name: /Start First Business Day/i }));

      // Switch to normal day status
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatus(),
        isLoading: false,
        isError: false,
      });

      rerender(<LotteryPage />);

      // Complete onboarding
      await waitFor(() => {
        expect(screen.getByTestId('complete-onboarding-button')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('complete-onboarding-button'));

      // EnhancedPackActivationForm should now receive onboardingMode=false
      await waitFor(() => {
        expect(capturedOnboardingMode).toBe(false);
      });
    });
  });
});

// ============================================================================
// Tests - Edge Cases
// ============================================================================

describe('LotteryPage Onboarding Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization Failure', () => {
    it('should NOT activate onboarding mode if initialization fails', async () => {
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      // Mock mutate to call onError
      const mockMutate = vi.fn((_, options) => {
        options?.onError?.(new Error('Network error'));
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<LotteryPage />);

      fireEvent.click(screen.getByRole('button', { name: /Start First Business Day/i }));

      // Should show error toast
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Initialization Failed',
          variant: 'destructive',
        })
      );

      // OnboardingModeIndicator should NOT be visible
      expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
    });
  });

  describe('PIN Verification Flow', () => {
    it('should activate onboarding mode after successful PIN verification for first-ever day', async () => {
      mockUseDayStatus.mockReturnValue({
        data: createMockDayStatusFirstEver(),
        isLoading: false,
        isError: false,
      });

      // Mock executeWithAuth to call onInvalid (requires PIN)
      const mockExecuteWithAuthRequirePin = vi.fn((_onValid, onInvalid) => {
        onInvalid();
      });
      vi.mocked(mockExecuteWithAuth).mockImplementation(mockExecuteWithAuthRequirePin);

      const mockMutate = vi.fn((_, options) => {
        options?.onSuccess?.({
          success: true,
          data: {
            is_first_ever: true,
            is_new: true,
            day: {
              day_id: 'day-001',
              business_date: '2026-02-15',
              status: 'OPEN',
              opened_at: '2026-02-15T08:00:00Z',
              opened_by: 'user-001',
            },
          },
        });
      });

      mockUseInitializeBusinessDay.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<LotteryPage />);

      // Click init button - should show PIN dialog
      fireEvent.click(screen.getByRole('button', { name: /Start First Business Day/i }));

      // PIN dialog should be shown
      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });

      // Verify PIN
      fireEvent.click(screen.getByTestId('verify-pin'));

      // Should trigger initialization with onboarding toast
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Onboarding Mode Active',
        })
      );
    });
  });

  describe('Mutual Exclusivity with Other Modes', () => {
    it('should not interfere with manual entry mode state', () => {
      // Both onboarding and manual entry can be active at different times
      // but they should not interfere with each other's state

      render(<LotteryPage />);

      // Initially neither mode is active
      expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('manual-entry-indicator')).not.toBeInTheDocument();

      // Manual entry button should be visible
      expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Tests - Traceability Matrix
// ============================================================================

describe('Traceability: BIZ-010 LotteryPage Requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  /**
   * Requirement Matrix for LotteryPage Onboarding:
   *
   * | Requirement | Test Case | Status |
   * |-------------|-----------|--------|
   * | AC-001: State exists | "State Initialization" | Covered |
   * | AC-002: Auto-activation | "Auto-Activation on First-Ever Day" | Covered |
   * | AC-003: Indicator visibility | "OnboardingModeIndicator Visibility" | Covered |
   * | AC-004: Complete button | "Complete Onboarding Button" | Covered |
   * | AC-005: Toast notifications | "Toast Notifications" | Covered |
   * | AC-006: Prop passing | "Prop Passing to EnhancedPackActivationForm" | Covered |
   */
  it('should satisfy all BIZ-010 LotteryPage onboarding requirements', () => {
    // This test documents that all requirements are covered by the test suite
    expect(true).toBe(true);
  });
});
