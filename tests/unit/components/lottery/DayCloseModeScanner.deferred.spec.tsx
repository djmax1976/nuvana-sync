/**
 * DayCloseModeScanner Deferred Commit Unit Tests
 *
 * Tests the deferred commit behavior for non-LOTTERY POS types:
 * - deferCommit=true skips API call
 * - deferCommit=true calls onPendingClosings with correct data
 * - deferCommit=true calls onSuccess with calculated totals
 * - onSuccess result does NOT include day_id in deferred mode
 * - Closings array includes all scanned bins
 * - Closings array includes is_sold_out flag correctly
 * - Entry method is 'SCAN' vs 'MANUAL' correctly set
 *
 * Story: Day Close & Lottery Close Bug Fix - Phase 3 Unit Tests
 *
 * MCP Guidance Applied:
 * - TEST-001: Unit tests are primary (70-80% of test suite)
 * - TEST-002: Single concept per test
 * - ARCH-004: Component-level isolation tests
 * - SEC-014: Validates closings data structure
 * - FE-002: FORM_VALIDATION tested
 *
 * @module tests/unit/components/lottery/DayCloseModeScanner.deferred
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ScannedBin, PendingClosingsData, LotteryCloseResult } from '../../../../src/renderer/components/lottery/DayCloseModeScanner';
import type { DayBin } from '../../../../src/renderer/lib/api/lottery';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock lottery API - critical to verify it's NOT called in deferred mode
const mockPrepareLotteryDayClose = vi.fn();
vi.mock('../../../../src/renderer/lib/api/lottery', () => ({
  prepareLotteryDayClose: (data: unknown) => mockPrepareLotteryDayClose(data),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('../../../../src/renderer/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock notification sound hook
vi.mock('../../../../src/renderer/hooks/use-notification-sound', () => ({
  useNotificationSound: () => ({
    playSuccess: vi.fn(),
    playError: vi.fn(),
    toggleMute: vi.fn(),
    isMuted: false,
  }),
}));

// Mock UI components
vi.mock('../../../../src/renderer/components/ui/card', () => ({
  Card: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="card" {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  CardHeader: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  CardTitle: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('../../../../src/renderer/components/ui/button', () => ({
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

vi.mock('../../../../src/renderer/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    ...props
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <input value={value} onChange={onChange} {...props} />
  ),
}));

vi.mock('../../../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: React.PropsWithChildren) =>
    <div data-testid="dialog-content">{children}</div>,
  DialogDescription: ({ children }: React.PropsWithChildren) =>
    <div>{children}</div>,
  DialogFooter: ({ children }: React.PropsWithChildren) =>
    <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) =>
    <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) =>
    <div>{children}</div>,
}));

vi.mock('../../../../src/renderer/components/ui/progress', () => ({
  Progress: ({ value }: { value?: number }) =>
    <div data-testid="progress" data-value={value}>Progress: {value}%</div>,
}));

vi.mock('../../../../src/renderer/components/ui/collapsible', () => ({
  Collapsible: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CollapsibleContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('../../../../src/renderer/components/ui/table', () => ({
  Table: ({ children }: React.PropsWithChildren) => <table>{children}</table>,
  TableBody: ({ children }: React.PropsWithChildren) => <tbody>{children}</tbody>,
  TableCell: ({ children }: React.PropsWithChildren) => <td>{children}</td>,
  TableHead: ({ children }: React.PropsWithChildren) => <th>{children}</th>,
  TableHeader: ({ children }: React.PropsWithChildren) => <thead>{children}</thead>,
  TableRow: ({ children }: React.PropsWithChildren) => <tr>{children}</tr>,
}));

vi.mock('../../../../src/renderer/components/ui/tooltip', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TooltipContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TooltipProvider: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TooltipTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('../../../../src/renderer/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

// Mock lucide-react icons using importOriginal to include all icons
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    // Test-specific overrides if needed
  };
});

// Mock sub-components
vi.mock('../../../../src/renderer/components/lottery/ScannerInput', () => ({
  ScannerInput: ({
    onScan,
    value,
    onChange,
  }: {
    onScan?: (serial: string) => void;
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <input
      data-testid="scanner-input"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value) {
          onScan?.(value);
        }
      }}
    />
  ),
}));

vi.mock('../../../../src/renderer/components/lottery/DayCloseScannerBar', () => ({
  DayCloseScannerBar: () => <div data-testid="scanner-bar">Scanner Bar</div>,
}));

vi.mock('../../../../src/renderer/components/lottery/BinActionsMenu', () => ({
  BinActionsMenu: () => <div data-testid="bin-actions-menu">Actions</div>,
}));

vi.mock('../../../../src/renderer/components/lottery/ReturnedPacksSection', () => ({
  ReturnedPacksSection: () => <div data-testid="returned-packs">Returned Packs</div>,
}));

vi.mock('../../../../src/renderer/components/lottery/DepletedPacksSection', () => ({
  DepletedPacksSection: () => <div data-testid="depleted-packs">Depleted Packs</div>,
}));

vi.mock('../../../../src/renderer/components/lottery/ActivatedPacksSection', () => ({
  ActivatedPacksSection: () => <div data-testid="activated-packs">Activated Packs</div>,
}));

// Import after mocks
import { DayCloseModeScanner } from '../../../../src/renderer/components/lottery/DayCloseModeScanner';

// ============================================================================
// Test Data Factories
// ============================================================================

function createBin(overrides: Partial<DayBin> = {}): DayBin {
  return {
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
    ...overrides,
  };
}

function createMultipleBins(): DayBin[] {
  return [
    createBin({
      bin_id: 'bin-uuid-001',
      bin_number: 1,
      pack: {
        pack_id: 'pack-uuid-001',
        pack_number: '1111111',
        game_name: 'Game A',
        game_price: 5,
        starting_serial: '000',
        ending_serial: null,
        serial_end: '029',
        is_first_period: true,
      },
    }),
    createBin({
      bin_id: 'bin-uuid-002',
      bin_number: 2,
      pack: {
        pack_id: 'pack-uuid-002',
        pack_number: '2222222',
        game_name: 'Game B',
        game_price: 10,
        starting_serial: '000',
        ending_serial: null,
        serial_end: '059',
        is_first_period: true,
      },
    }),
  ];
}

function createScannedBins(bins: DayBin[]): ScannedBin[] {
  return bins.map((bin) => ({
    bin_id: bin.bin_id,
    bin_number: bin.bin_number,
    pack_id: bin.pack!.pack_id,
    pack_number: bin.pack!.pack_number,
    game_name: bin.pack!.game_name,
    closing_serial: '015', // Mid-pack scan
    is_sold_out: false,
  }));
}

// ============================================================================
// Test Helpers
// ============================================================================

interface RenderScannerOptions {
  deferCommit?: boolean;
  onPendingClosings?: (data: PendingClosingsData) => void;
  onSuccess?: (data: LotteryCloseResult) => void;
  onCancel?: () => void;
  bins?: DayBin[];
  scannedBins?: ScannedBin[];
  onScannedBinsChange?: (bins: ScannedBin[]) => void;
}

function renderScanner(options: RenderScannerOptions = {}) {
  const {
    deferCommit = true,
    onPendingClosings = vi.fn(),
    onSuccess = vi.fn(),
    onCancel = vi.fn(),
    bins = [createBin()],
    scannedBins = [],
    onScannedBinsChange = vi.fn(),
  } = options;

  return render(
    <DayCloseModeScanner
      storeId="store-uuid-001"
      bins={bins}
      currentShiftId="shift-uuid-001"
      onCancel={onCancel}
      onSuccess={onSuccess}
      scannedBins={scannedBins}
      onScannedBinsChange={onScannedBinsChange}
      deferCommit={deferCommit}
      onPendingClosings={onPendingClosings}
    />
  );
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockPrepareLotteryDayClose.mockResolvedValue({
    success: true,
    data: {
      day_id: 'day-uuid-prepared',
      business_date: '2026-02-13',
      closings_count: 1,
      estimated_lottery_total: 75,
      bins_preview: [],
    },
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: deferCommit=true Skips API Call
// ============================================================================

describe('DayCloseModeScanner - deferCommit=true Skips API', () => {
  it('does NOT call prepareLotteryDayClose when deferCommit=true', async () => {
    const bins = createMultipleBins();
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();
    const onPendingClosings = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
      onPendingClosings,
    });

    // Click Close Lottery button
    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      // API should NOT be called
      expect(mockPrepareLotteryDayClose).not.toHaveBeenCalled();
      // But onSuccess should be called
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('DOES call prepareLotteryDayClose when deferCommit=false', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: false,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(mockPrepareLotteryDayClose).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// TEST SUITE: onPendingClosings Callback
// ============================================================================

describe('DayCloseModeScanner - onPendingClosings Callback', () => {
  it('calls onPendingClosings with correct closings data structure', async () => {
    const bins = createMultipleBins();
    const scannedBins = createScannedBins(bins);
    const onPendingClosings = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onPendingClosings,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onPendingClosings).toHaveBeenCalledWith(
        expect.objectContaining({
          closings: expect.arrayContaining([
            expect.objectContaining({
              pack_id: 'pack-uuid-001',
              closing_serial: '015',
              is_sold_out: false,
            }),
            expect.objectContaining({
              pack_id: 'pack-uuid-002',
              closing_serial: '015',
              is_sold_out: false,
            }),
          ]),
          entry_method: 'SCAN',
        })
      );
    });
  });

  it('includes all scanned bins in closings array', async () => {
    const bins = createMultipleBins();
    const scannedBins = createScannedBins(bins);
    const onPendingClosings = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onPendingClosings,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onPendingClosings).toHaveBeenCalled();
      const callArg = onPendingClosings.mock.calls[0][0] as PendingClosingsData;
      expect(callArg.closings).toHaveLength(2);
    });
  });

  it('includes is_sold_out flag correctly in closings', async () => {
    const bins = createMultipleBins();
    const scannedBins: ScannedBin[] = [
      {
        bin_id: 'bin-uuid-001',
        bin_number: 1,
        pack_id: 'pack-uuid-001',
        pack_number: '1111111',
        game_name: 'Game A',
        closing_serial: '015',
        is_sold_out: false, // Normal scan
      },
      {
        bin_id: 'bin-uuid-002',
        bin_number: 2,
        pack_id: 'pack-uuid-002',
        pack_number: '2222222',
        game_name: 'Game B',
        closing_serial: '059', // Sold out (matches serial_end)
        is_sold_out: true, // Sold out
      },
    ];
    const onPendingClosings = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onPendingClosings,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onPendingClosings).toHaveBeenCalled();
      const callArg = onPendingClosings.mock.calls[0][0] as PendingClosingsData;

      // Find the closings by pack_id
      const closing1 = callArg.closings.find((c) => c.pack_id === 'pack-uuid-001');
      const closing2 = callArg.closings.find((c) => c.pack_id === 'pack-uuid-002');

      expect(closing1?.is_sold_out).toBe(false);
      expect(closing2?.is_sold_out).toBe(true);
    });
  });

  it('sets entry_method to SCAN for scanned bins', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onPendingClosings = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onPendingClosings,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onPendingClosings).toHaveBeenCalled();
      const callArg = onPendingClosings.mock.calls[0][0] as PendingClosingsData;
      expect(callArg.entry_method).toBe('SCAN');
    });
  });
});

// ============================================================================
// TEST SUITE: onSuccess Callback in Deferred Mode
// ============================================================================

describe('DayCloseModeScanner - onSuccess in Deferred Mode', () => {
  it('calls onSuccess with locally calculated totals', async () => {
    const bins = createMultipleBins();
    // Pack 1: starting=000, closing=015, price=$5 → 15 tickets × $5 = $75
    // Pack 2: starting=000, closing=015, price=$10 → 15 tickets × $10 = $150
    // Total = $225
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          closings_created: 2,
          lottery_total: 225, // (15 × $5) + (15 × $10)
        })
      );
    });
  });

  it('does NOT include day_id in onSuccess result for deferred mode', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      expect(callArg.day_id).toBeUndefined();
    });
  });

  it('includes bins_closed preview in onSuccess result', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      expect(callArg.bins_closed).toBeDefined();
      expect(callArg.bins_closed!.length).toBe(1);
      expect(callArg.bins_closed![0]).toEqual(
        expect.objectContaining({
          bin_number: 1,
          pack_number: '1234567',
          game_name: 'Test Game',
          closing_serial: '015',
        })
      );
    });
  });

  it('includes business_date in onSuccess result', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      // Should be today's date in YYYY-MM-DD format
      expect(callArg.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('calculates tickets_sold correctly for normal scan', async () => {
    const bins = [
      createBin({
        pack: {
          pack_id: 'pack-uuid-001',
          pack_number: '1234567',
          game_name: 'Test Game',
          game_price: 5,
          starting_serial: '010', // Starting at 10
          ending_serial: null,
          serial_end: '029',
          is_first_period: true,
        },
      }),
    ];
    const scannedBins: ScannedBin[] = [
      {
        bin_id: 'bin-uuid-001',
        bin_number: 1,
        pack_id: 'pack-uuid-001',
        pack_number: '1234567',
        game_name: 'Test Game',
        closing_serial: '025', // Ending at 25
        is_sold_out: false,
      },
    ];
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      // Normal mode: 25 - 10 = 15 tickets
      expect(callArg.bins_closed![0].tickets_sold).toBe(15);
      expect(callArg.bins_closed![0].sales_amount).toBe(75); // 15 × $5
    });
  });

  it('calculates tickets_sold correctly for sold-out pack', async () => {
    const bins = [
      createBin({
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
      }),
    ];
    const scannedBins: ScannedBin[] = [
      {
        bin_id: 'bin-uuid-001',
        bin_number: 1,
        pack_id: 'pack-uuid-001',
        pack_number: '1234567',
        game_name: 'Test Game',
        closing_serial: '029', // Last ticket (sold out)
        is_sold_out: true, // SEC-014: Sold out flag
      },
    ];
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      // Sold out mode: (29 + 1) - 0 = 30 tickets
      expect(callArg.bins_closed![0].tickets_sold).toBe(30);
      expect(callArg.bins_closed![0].sales_amount).toBe(150); // 30 × $5
    });
  });
});

// ============================================================================
// TEST SUITE: Normal Mode (deferCommit=false) Comparison
// ============================================================================

describe('DayCloseModeScanner - deferCommit=false (Normal Mode)', () => {
  it('includes day_id in onSuccess result when API succeeds', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onSuccess = vi.fn();

    mockPrepareLotteryDayClose.mockResolvedValue({
      success: true,
      data: {
        day_id: 'day-uuid-from-api',
        business_date: '2026-02-13',
        closings_count: 1,
        estimated_lottery_total: 75,
        bins_preview: [{
          bin_number: 1,
          pack_number: '1234567',
          game_name: 'Test Game',
          starting_serial: '000',
          closing_serial: '015',
          game_price: 5,
          tickets_sold: 15,
          sales_amount: 75,
        }],
        pending_close_expires_at: '2026-02-13T23:59:59.000Z',
      },
    });

    renderScanner({
      deferCommit: false,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      expect(callArg.day_id).toBe('day-uuid-from-api');
    });
  });

  it('does NOT call onPendingClosings in normal mode', async () => {
    const bins = [createBin()];
    const scannedBins = createScannedBins(bins);
    const onPendingClosings = vi.fn();

    mockPrepareLotteryDayClose.mockResolvedValue({
      success: true,
      data: {
        day_id: 'day-uuid-from-api',
        business_date: '2026-02-13',
        closings_count: 1,
        estimated_lottery_total: 75,
        bins_preview: [],
        pending_close_expires_at: '2026-02-13T23:59:59.000Z',
      },
    });

    renderScanner({
      deferCommit: false,
      bins,
      scannedBins,
      onPendingClosings,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(mockPrepareLotteryDayClose).toHaveBeenCalled();
    });

    // onPendingClosings should NOT be called in normal mode
    expect(onPendingClosings).not.toHaveBeenCalled();
  });
});

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================

describe('DayCloseModeScanner - Deferred Mode Edge Cases', () => {
  it('handles empty scannedBins array gracefully', async () => {
    const bins = createMultipleBins();
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins: [], // No bins scanned yet
      onSuccess,
    });

    // Close button should be disabled
    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    expect(closeBtn).toBeDisabled();
  });

  it('handles bins with no pack gracefully', async () => {
    const bins = [
      createBin({ pack: null }), // Empty bin
      createBin({
        bin_id: 'bin-uuid-002',
        bin_number: 2,
        pack: {
          pack_id: 'pack-uuid-002',
          pack_number: '2222222',
          game_name: 'Game B',
          game_price: 10,
          starting_serial: '000',
          ending_serial: null,
          serial_end: '029',
          is_first_period: true,
        },
      }),
    ];
    const scannedBins: ScannedBin[] = [
      {
        bin_id: 'bin-uuid-002',
        bin_number: 2,
        pack_id: 'pack-uuid-002',
        pack_number: '2222222',
        game_name: 'Game B',
        closing_serial: '015',
        is_sold_out: false,
      },
    ];
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    // Should only need to scan the bin with a pack
    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('handles invalid closing_serial parsing gracefully', async () => {
    const bins = [createBin()];
    const scannedBins: ScannedBin[] = [
      {
        bin_id: 'bin-uuid-001',
        bin_number: 1,
        pack_id: 'pack-uuid-001',
        pack_number: '1234567',
        game_name: 'Test Game',
        closing_serial: 'ABC', // Invalid serial
        is_sold_out: false,
      },
    ];
    const onSuccess = vi.fn();

    renderScanner({
      deferCommit: true,
      bins,
      scannedBins,
      onSuccess,
    });

    const closeBtn = screen.getByRole('button', { name: /close lottery/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      const callArg = onSuccess.mock.calls[0][0] as LotteryCloseResult;
      // Should handle gracefully with 0 tickets
      expect(callArg.bins_closed![0].tickets_sold).toBe(0);
      expect(callArg.bins_closed![0].sales_amount).toBe(0);
    });
  });
});
