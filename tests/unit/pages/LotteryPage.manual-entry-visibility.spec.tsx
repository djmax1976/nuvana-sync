/**
 * LotteryPage Manual Entry Visibility Unit Tests
 *
 * Tests Manual Entry button visibility based on `can_close_independently` flag.
 * This flag is controlled by the backend based on POS type configuration.
 *
 * Story: No Manual Entry for Non-Lottery Configuration - Phase 4
 *
 * Traceability:
 * - SEC-010-001: Manual Entry hidden for non-LOTTERY stores
 * - UI-001: Manual Entry button NOT rendered when can_close_independently: false
 * - UI-002: Manual Entry button rendered when can_close_independently: true
 * - UI-003: Cancel Manual Entry button NOT rendered when can_close_independently: false
 * - UI-004: Save & Close Lottery button NOT rendered when can_close_independently: false
 * - UI-005: All lottery management functions work for LOTTERY stores
 * - UI-006: Close Day button visibility unchanged (regression test)
 *
 * MCP Guidance Applied:
 * - TEST-001: Unit tests are primary (70-80% of test suite)
 * - TEST-002: Single concept per test
 * - ARCH-004: Component-level isolation tests
 * - SEC-010: AUTHZ - Frontend respects backend authorization flag
 *
 * @module tests/unit/pages/LotteryPage.manual-entry-visibility
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

// BIZ-012-FIX: Mock onboarding hooks
const mockUseOnboardingStatus = vi.fn();
const mockUseCompleteOnboarding = vi.fn();

vi.mock('../../../src/renderer/hooks/useLottery', () => ({
  useLotteryPacks: () => mockUseLotteryPacks(),
  usePackDetails: () => mockUsePackDetails(),
  useInvalidateLottery: () => mockUseInvalidateLottery(),
  useLotteryDayBins: () => mockUseLotteryDayBins(),
  useDayStatus: () => mockUseDayStatus(),
  useInitializeBusinessDay: () => mockUseInitializeBusinessDay(),
  // BIZ-012-FIX: Add onboarding hooks
  useOnboardingStatus: () => mockUseOnboardingStatus(),
  useCompleteOnboarding: () => mockUseCompleteOnboarding(),
}));

// Mock useAuthGuard - returns an object with executeWithAuth that calls the callback immediately
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
    data: { closings_created: 3, business_date: '2026-02-05' },
  }),
}));

// Mock lottery closing validation
vi.mock('../../../src/renderer/lib/services/lottery-closing-validation', () => ({
  validateManualEntryEnding: vi.fn().mockResolvedValue({ valid: true }),
}));

// Mock components that are complex to test
vi.mock('../../../src/renderer/components/lottery/DayBinsTable', () => ({
  DayBinsTable: vi.fn(
    ({
      bins,
      scannedBins,
      lastScannedBinId,
      onUndoScan,
      scannerModeActive,
      manualEntryMode,
      endingValues,
      'data-testid': testId,
    }) => (
      <div data-testid={testId || 'day-bins-table'}>
        <div data-testid="scanner-mode-active">{String(scannerModeActive)}</div>
        <div data-testid="manual-entry-mode">{String(manualEntryMode)}</div>
        <div data-testid="scanned-count">{scannedBins?.length ?? 0}</div>
        <div data-testid="last-scanned-id">{lastScannedBinId || 'none'}</div>
        {bins?.map((bin: { bin_id: string; pack?: { pack_id: string } | null }) => (
          <div key={bin.bin_id} data-testid={`bin-row-${bin.bin_id}`}>
            {bin.pack && (
              <button
                data-testid={`undo-scan-${bin.bin_id}`}
                onClick={() => onUndoScan?.(bin.bin_id)}
              >
                Undo
              </button>
            )}
            <span data-testid={`ending-value-${bin.bin_id}`}>
              {endingValues?.[bin.bin_id] || '--'}
            </span>
          </div>
        ))}
      </div>
    )
  ),
}));

vi.mock('../../../src/renderer/components/lottery/DayCloseScannerBar', () => ({
  DayCloseScannerBar: vi.fn(
    ({
      bins,
      scannedBins,
      onScan,
      onScanError,
      onCancel,
      onComplete,
      isMuted,
      onToggleMute,
      isComplete,
      'data-testid': testId,
    }) => (
      <div data-testid={testId || 'day-close-scanner-bar'}>
        <input
          data-testid="scanner-input"
          onChange={(e) => {
            if (e.target.value.length === 24 && /^\d+$/.test(e.target.value)) {
              onScan(e.target.value);
            } else if (e.target.value === 'ERROR') {
              onScanError?.();
            }
          }}
        />
        <span data-testid="progress">
          {scannedBins?.length ?? 0}/{bins?.filter((b: { pack?: unknown }) => b.pack)?.length ?? 0}
        </span>
        <button data-testid="cancel-scanner" onClick={onCancel}>
          Cancel
        </button>
        <button data-testid="complete-scanner" onClick={onComplete} disabled={!isComplete}>
          Complete
        </button>
        <button data-testid="toggle-mute" onClick={onToggleMute}>
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
      </div>
    )
  ),
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

vi.mock('../../../src/renderer/components/lottery/EnhancedPackActivationForm', () => ({
  EnhancedPackActivationForm: () => <div data-testid="pack-activation-form" />,
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
  PinVerificationDialog: vi.fn(({ open, onVerified, 'data-testid': testId }) => {
    if (!open) return null;
    return (
      <div data-testid={testId || 'pin-dialog'}>
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
      business_date: '2026-02-05',
      status: 'OPEN',
      opened_at: '2026-02-05T08:00:00Z',
      opened_by: 'user-001',
    },
    today: '2026-02-05',
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

/**
 * Creates mock day bins data for LOTTERY POS type stores.
 * can_close_independently: true means the store can close lottery independently.
 *
 * SEC-010: This factory creates data for stores that CAN close independently.
 */
function createMockDayBinsForLotteryStore() {
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
      {
        bin_id: 'bin-002',
        bin_number: 2,
        name: 'Bin 2',
        is_active: true,
        pack: {
          pack_id: 'pack-002',
          pack_number: '2345678',
          game_name: 'Mega Millions',
          game_price: 2,
          starting_serial: '000',
          ending_serial: null,
          serial_end: '149',
          is_first_period: false,
        },
      },
      {
        bin_id: 'bin-003',
        bin_number: 3,
        name: 'Bin 3',
        is_active: true,
        pack: null, // Empty bin
      },
    ],
    business_day: {
      date: '2026-02-05',
      day_id: 'day-001',
      status: 'OPEN',
      first_shift_opened_at: '2026-02-05T08:00:00Z',
      last_shift_closed_at: null,
      shifts_count: 1,
    },
    open_business_period: {
      started_at: '2026-02-05T08:00:00Z',
      last_closed_date: '2026-02-04',
      days_since_last_close: 1,
      is_first_period: false,
    },
    depleted_packs: [],
    activated_packs: [],
    returned_packs: [],
    day_close_summary: null,
    // SEC-010: LOTTERY POS type can close independently
    can_close_independently: true,
  };
}

/**
 * Creates mock day bins data for non-LOTTERY POS type stores.
 * can_close_independently: false means the store CANNOT close lottery independently.
 *
 * SEC-010: This factory creates data for stores that CANNOT close independently.
 * These stores must use the Day Close Wizard to close lottery.
 */
function createMockDayBinsForNonLotteryStore() {
  return {
    ...createMockDayBinsForLotteryStore(),
    // SEC-010: Non-LOTTERY POS type (e.g., GILBARCO_PASSPORT) cannot close independently
    can_close_independently: false,
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

  // Default to LOTTERY store (can close independently)
  mockUseLotteryDayBins.mockReturnValue({
    data: createMockDayBinsForLotteryStore(),
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

  // BIZ-012-FIX: Mock onboarding status (default: not in onboarding)
  mockUseOnboardingStatus.mockReturnValue({
    data: { isOnboarding: false, dayId: null, businessDate: null, openedAt: null },
    isLoading: false,
  });

  // BIZ-012-FIX: Mock complete onboarding mutation
  mockUseCompleteOnboarding.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

// ============================================================================
// Tests - Manual Entry Button Visibility (SEC-010)
// ============================================================================

describe('LotteryPage Manual Entry Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // UI-001: Manual Entry button NOT rendered when can_close_independently: false
  // --------------------------------------------------------------------------
  describe('UI-001: Manual Entry Hidden for Non-LOTTERY Stores', () => {
    it('should NOT render Manual Entry button when can_close_independently is false', () => {
      // Arrange: Non-LOTTERY store (e.g., GILBARCO_PASSPORT)
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Manual Entry button should NOT be present
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
      expect(screen.queryByText('Manual Entry')).not.toBeInTheDocument();
    });

    it('should NOT render Manual Entry button when data is null (fail-safe)', () => {
      // Arrange: No data available
      mockUseLotteryDayBins.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Manual Entry button should NOT be present
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
    });

    it('should NOT render Manual Entry button during loading state', () => {
      // Arrange: Loading state
      mockUseLotteryDayBins.mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Manual Entry button should NOT be present
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // UI-002: Manual Entry button rendered when can_close_independently: true
  // --------------------------------------------------------------------------
  describe('UI-002: Manual Entry Visible for LOTTERY Stores', () => {
    it('should render Manual Entry button when can_close_independently is true', () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Manual Entry button should be present
      expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
    });

    it('should enable Manual Entry button when bins have active packs', () => {
      // Arrange: LOTTERY store with active packs
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Manual Entry button should be enabled
      const button = screen.getByTestId('manual-entry-button');
      expect(button).not.toBeDisabled();
    });

    it('should disable Manual Entry button when no bins have active packs', () => {
      // Arrange: LOTTERY store with no active packs
      const dataWithEmptyBins = {
        ...createMockDayBinsForLotteryStore(),
        bins: [
          {
            bin_id: 'bin-001',
            bin_number: 1,
            name: 'Bin 1',
            is_active: true,
            pack: null, // No pack
          },
        ],
      };

      mockUseLotteryDayBins.mockReturnValue({
        data: dataWithEmptyBins,
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Manual Entry button should be disabled
      const button = screen.getByTestId('manual-entry-button');
      expect(button).toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // UI-003: Cancel Manual Entry button NOT rendered when can_close_independently: false
  // --------------------------------------------------------------------------
  describe('UI-003: Cancel Manual Entry Hidden for Non-LOTTERY Stores', () => {
    it('should NOT render Cancel Manual Entry button for non-LOTTERY stores even if manual entry was somehow active', () => {
      // Arrange: Non-LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Cancel Manual Entry button should NOT be present
      // (can never be present since Manual Entry button is also hidden)
      expect(screen.queryByTestId('cancel-manual-entry-button')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // UI-004: Save & Close Lottery button NOT rendered when can_close_independently: false
  // --------------------------------------------------------------------------
  describe('UI-004: Save & Close Lottery Hidden for Non-LOTTERY Stores', () => {
    it('should NOT render Save & Close Lottery button for non-LOTTERY stores', () => {
      // Arrange: Non-LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Save & Close Lottery button should NOT be present
      expect(screen.queryByTestId('save-close-lottery-button')).not.toBeInTheDocument();
    });

    it('should NOT render Save & Close Lottery button when data is null', () => {
      // Arrange: No data
      mockUseLotteryDayBins.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Save & Close Lottery button should NOT be present
      expect(screen.queryByTestId('save-close-lottery-button')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // UI-005: All lottery management functions work for LOTTERY stores
  // --------------------------------------------------------------------------
  describe('UI-005: Full Functionality for LOTTERY Stores', () => {
    it('should render both Close Day and Manual Entry buttons for LOTTERY stores', () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Both buttons should be present
      expect(screen.getByTestId('close-day-button')).toBeInTheDocument();
      expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
    });

    it('should render Activate Pack button for LOTTERY stores', () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Activate Pack button should be present
      expect(screen.getByTestId('activate-pack-button')).toBeInTheDocument();
    });

    it('should show Cancel Manual Entry and Save buttons when manual entry is active for LOTTERY stores', async () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Click Manual Entry to activate manual entry mode
      const manualEntryButton = screen.getByTestId('manual-entry-button');
      fireEvent.click(manualEntryButton);

      // Assert: Manual Entry button should be replaced with Cancel button
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('cancel-manual-entry-button')).toBeInTheDocument();

      // Save & Close Lottery button should appear
      expect(screen.getByTestId('save-close-lottery-button')).toBeInTheDocument();
    });

    it('should exit manual entry mode when Cancel is clicked for LOTTERY stores', async () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Enter manual entry mode
      fireEvent.click(screen.getByTestId('manual-entry-button'));
      expect(screen.getByTestId('cancel-manual-entry-button')).toBeInTheDocument();

      // Click Cancel
      fireEvent.click(screen.getByTestId('cancel-manual-entry-button'));

      // Assert: Should return to normal state
      await waitFor(() => {
        expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('cancel-manual-entry-button')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // UI-006: Close Day button visibility unchanged (regression test)
  // --------------------------------------------------------------------------
  describe('UI-006: Close Day Button Visibility Regression Tests', () => {
    it('should render Close Day button when can_close_independently is true', () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Close Day button should be present
      expect(screen.getByTestId('close-day-button')).toBeInTheDocument();
    });

    it('should NOT render Close Day button when can_close_independently is false', () => {
      // Arrange: Non-LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Close Day button should NOT be present
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();
    });

    it('should hide Close Day button when scanner mode is active', async () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Enter scanner mode
      fireEvent.click(screen.getByTestId('close-day-button'));

      // Assert: Close Day button should be hidden
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();
    });

    it('should hide Close Day button when manual entry mode is active', async () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Enter manual entry mode
      fireEvent.click(screen.getByTestId('manual-entry-button'));

      // Assert: Close Day button should be hidden
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();
    });

    it('should show Close Day button again after exiting manual entry mode', async () => {
      // Arrange: LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Enter manual entry mode
      fireEvent.click(screen.getByTestId('manual-entry-button'));
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();

      // Exit manual entry mode
      fireEvent.click(screen.getByTestId('cancel-manual-entry-button'));

      // Assert: Close Day button should be visible again
      await waitFor(() => {
        expect(screen.getByTestId('close-day-button')).toBeInTheDocument();
      });
    });
  });
});

// ============================================================================
// Tests - Non-LOTTERY Store Behavior (SEC-010 Enforcement)
// ============================================================================

describe('SEC-010: Non-LOTTERY Store Manual Entry Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Button Visibility for Non-LOTTERY POS Types', () => {
    it('SEC-010-FE-001: should hide all day close buttons for non-LOTTERY stores', () => {
      // Arrange: Non-LOTTERY store (e.g., GILBARCO_PASSPORT, VERIFONE_RUBY2, SQUARE_REST)
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: All day close-related buttons should be hidden
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('cancel-manual-entry-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-close-lottery-button')).not.toBeInTheDocument();
    });

    it('SEC-010-FE-002: should still render Activate Pack button for non-LOTTERY stores', () => {
      // Arrange: Non-LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: Activate Pack button should still be visible
      // (Non-LOTTERY stores can still manage pack activation)
      expect(screen.getByTestId('activate-pack-button')).toBeInTheDocument();
    });

    it('SEC-010-FE-003: should render DayBinsTable for non-LOTTERY stores', () => {
      // Arrange: Non-LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      render(<LotteryPage />);

      // Assert: DayBinsTable should be rendered (viewing is allowed)
      expect(screen.getByTestId('day-bins-table')).toBeInTheDocument();
    });
  });

  describe('Consistency Across State Changes', () => {
    it('SEC-010-FE-004: buttons should remain hidden after any re-render for non-LOTTERY stores', async () => {
      // Arrange: Non-LOTTERY store
      mockUseLotteryDayBins.mockReturnValue({
        data: createMockDayBinsForNonLotteryStore(),
        isLoading: false,
        isError: false,
        error: null,
      });

      // Act
      const { rerender } = render(<LotteryPage />);

      // Verify initial state
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();

      // Trigger re-render
      rerender(<LotteryPage />);

      // Assert: Buttons should still be hidden
      expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();
    });
  });
});

// ============================================================================
// Tests - Traceability Requirements Matrix
// ============================================================================

describe('Traceability: SEC-010-001 Requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  /**
   * Requirement Matrix:
   *
   * | Requirement | Component | Test Status |
   * |-------------|-----------|-------------|
   * | SEC-010-001 | Manual Entry hidden | UI-001 |
   * | SEC-010-001 | Cancel hidden | UI-003 |
   * | SEC-010-001 | Save hidden | UI-004 |
   * | SEC-010-001 | Close Day hidden | UI-006 |
   * | SEC-010-001 | Activate Pack visible | SEC-010-FE-002 |
   */
  it('should satisfy all SEC-010-001 requirements for non-LOTTERY stores', () => {
    // Arrange: Non-LOTTERY store
    mockUseLotteryDayBins.mockReturnValue({
      data: createMockDayBinsForNonLotteryStore(),
      isLoading: false,
      isError: false,
      error: null,
    });

    // Act
    render(<LotteryPage />);

    // Assert all SEC-010-001 requirements
    // 1. Manual Entry button hidden
    expect(screen.queryByTestId('manual-entry-button')).not.toBeInTheDocument();

    // 2. Cancel Manual Entry button hidden
    expect(screen.queryByTestId('cancel-manual-entry-button')).not.toBeInTheDocument();

    // 3. Save & Close Lottery button hidden
    expect(screen.queryByTestId('save-close-lottery-button')).not.toBeInTheDocument();

    // 4. Close Day button hidden
    expect(screen.queryByTestId('close-day-button')).not.toBeInTheDocument();

    // 5. Activate Pack button visible (pack management still allowed)
    expect(screen.getByTestId('activate-pack-button')).toBeInTheDocument();

    // 6. DayBinsTable visible (viewing still allowed)
    expect(screen.getByTestId('day-bins-table')).toBeInTheDocument();
  });
});
