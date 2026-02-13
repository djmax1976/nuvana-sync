/**
 * DayCloseScannerBar Unit Tests
 *
 * Tests the DayCloseScannerBar component for:
 * - Progress calculation and display
 * - Mute toggle functionality
 * - Cancel/Complete button callbacks
 * - Sticky/floating positioning
 * - Disabled states during submission
 * - Accessibility attributes
 *
 * Story: Lottery Day Close Scanner Feature - Phase 2
 *
 * Traceability:
 * - REQ-010: Sound feedback (toggleable)
 * - REQ-011: Progress indicator (X/Y bins scanned)
 * - REQ-012: Floating scan bar (sticky when scrolling)
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/DayCloseScannerBar
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock ScannerInput to simplify testing
vi.mock('../../../../src/renderer/components/lottery/ScannerInput', () => ({
  ScannerInput: vi.fn(({ onScan, onScanError, disabled, 'data-testid': testId }) => (
    <input
      data-testid={testId || 'scanner-input'}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === 'VALID_SCAN') {
          onScan?.('000112345670123456789012');
        } else if (e.target.value === 'ERROR') {
          onScanError?.();
        }
      }}
    />
  )),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Scan: (props: Record<string, unknown>) => <div data-testid="scan-icon" {...props} />,
  Volume2: (props: Record<string, unknown>) => <div data-testid="volume-on-icon" {...props} />,
  VolumeX: (props: Record<string, unknown>) => <div data-testid="volume-off-icon" {...props} />,
  X: (props: Record<string, unknown>) => <div data-testid="x-icon" {...props} />,
  ArrowRight: (props: Record<string, unknown>) => <div data-testid="arrow-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <div data-testid="loader-icon" {...props} />,
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import { DayCloseScannerBar } from '../../../../src/renderer/components/lottery/DayCloseScannerBar';
import type { DayBin, DayBinPack } from '../../../../src/renderer/lib/api/lottery';
import type { ScannedBin } from '../../../../src/renderer/hooks/useScannedBins';

// ============================================================================
// Test Fixtures
// ============================================================================

function createPack(overrides: Partial<DayBinPack> = {}): DayBinPack {
  return {
    pack_id: 'pack-001',
    pack_number: '1234567',
    game_name: 'Powerball',
    game_price: 5,
    starting_serial: '000',
    ending_serial: null,
    serial_end: '299',
    is_first_period: false,
    ...overrides,
  };
}

function createBin(overrides: Partial<DayBin> = {}): DayBin {
  return {
    bin_id: 'bin-001',
    bin_number: 1,
    name: 'Bin 1',
    is_active: true,
    pack: createPack(),
    ...overrides,
  };
}

function createEmptyBin(overrides: Partial<DayBin> = {}): DayBin {
  return {
    bin_id: 'bin-empty',
    bin_number: 5,
    name: 'Bin 5',
    is_active: true,
    pack: null,
    ...overrides,
  };
}

function createScannedBin(overrides: Partial<ScannedBin> = {}): ScannedBin {
  return {
    bin_id: 'bin-001',
    bin_number: 1,
    pack_id: 'pack-001',
    pack_number: '1234567',
    game_name: 'Powerball',
    closing_serial: '015',
    ...overrides,
  };
}

function createDefaultProps() {
  return {
    bins: [
      createBin({ bin_id: 'b1', bin_number: 1, pack: createPack({ pack_id: 'p1' }) }),
      createBin({ bin_id: 'b2', bin_number: 2, pack: createPack({ pack_id: 'p2', pack_number: '2345678' }) }),
      createBin({ bin_id: 'b3', bin_number: 3, pack: createPack({ pack_id: 'p3', pack_number: '3456789' }) }),
      createEmptyBin({ bin_id: 'b4', bin_number: 4 }),
    ],
    scannedBins: [] as ScannedBin[],
    onScan: vi.fn(),
    onScanError: vi.fn(),
    onCancel: vi.fn(),
    onComplete: vi.fn(),
    isMuted: false,
    onToggleMute: vi.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('DayCloseScannerBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render with data-testid', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByTestId('day-close-scanner-bar')).toBeInTheDocument();
    });

    it('should render with custom data-testid', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} data-testid="custom-bar" />);
      expect(screen.getByTestId('custom-bar')).toBeInTheDocument();
    });

    it('should render scanner icon', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByTestId('scan-icon')).toBeInTheDocument();
    });

    it('should render "Scan Ticket" label on larger screens', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByText('Scan Ticket')).toBeInTheDocument();
    });

    it('should render scanner input', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByTestId('scanner-bar-input')).toBeInTheDocument();
    });

    it('should render Cancel button', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByTestId('scanner-cancel-button')).toBeInTheDocument();
    });

    it('should render Continue button', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByTestId('scanner-complete-button')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Progress Calculation
  // --------------------------------------------------------------------------
  describe('Progress Calculation', () => {
    it('should show 0/3 when no bins are scanned (3 active, 1 empty)', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByTestId('scanner-progress')).toHaveTextContent('0/3');
    });

    it('should show 1/3 when 1 of 3 bins is scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [createScannedBin({ bin_id: 'b1' })];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByTestId('scanner-progress')).toHaveTextContent('1/3');
    });

    it('should show 3/3 when all bins are scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [
        createScannedBin({ bin_id: 'b1', bin_number: 1 }),
        createScannedBin({ bin_id: 'b2', bin_number: 2, pack_number: '2345678' }),
        createScannedBin({ bin_id: 'b3', bin_number: 3, pack_number: '3456789' }),
      ];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByTestId('scanner-progress')).toHaveTextContent('3/3');
    });

    it('should show 0% in progress bar when no scans', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('should show 33% in progress bar when 1 of 3 scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [createScannedBin({ bin_id: 'b1' })];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByText('33%')).toBeInTheDocument();
    });

    it('should show 100% in progress bar when all scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [
        createScannedBin({ bin_id: 'b1' }),
        createScannedBin({ bin_id: 'b2', pack_number: '2345678' }),
        createScannedBin({ bin_id: 'b3', pack_number: '3456789' }),
      ];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should have aria-label on progress indicator', () => {
      const props = createDefaultProps();
      props.scannedBins = [createScannedBin({ bin_id: 'b1' })];
      render(<DayCloseScannerBar {...props} />);
      // Phase 5.4: aria-label now includes empty bins count
      // Default props have 3 active bins + 1 empty bin
      expect(screen.getByTestId('scanner-progress')).toHaveAttribute(
        'aria-label',
        '1 of 3 bins scanned, 1 empty'
      );
    });
  });

  // --------------------------------------------------------------------------
  // Mute Toggle
  // --------------------------------------------------------------------------
  describe('Mute Toggle', () => {
    it('should show volume-on icon when not muted', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isMuted={false} />);
      expect(screen.getByTestId('volume-on-icon')).toBeInTheDocument();
      expect(screen.queryByTestId('volume-off-icon')).not.toBeInTheDocument();
    });

    it('should show volume-off icon when muted', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isMuted={true} />);
      expect(screen.getByTestId('volume-off-icon')).toBeInTheDocument();
      expect(screen.queryByTestId('volume-on-icon')).not.toBeInTheDocument();
    });

    it('should call onToggleMute when sound button clicked', () => {
      const props = createDefaultProps();
      render(<DayCloseScannerBar {...props} />);
      fireEvent.click(screen.getByTestId('scanner-sound-toggle'));
      expect(props.onToggleMute).toHaveBeenCalledTimes(1);
    });

    it('should have correct aria-label when not muted', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isMuted={false} />);
      const toggle = screen.getByTestId('scanner-sound-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Disable scan sounds');
    });

    it('should have correct aria-label when muted', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isMuted={true} />);
      const toggle = screen.getByTestId('scanner-sound-toggle');
      expect(toggle).toHaveAttribute('aria-label', 'Enable scan sounds');
    });

    it('should have aria-pressed attribute', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isMuted={false} />);
      const toggle = screen.getByTestId('scanner-sound-toggle');
      expect(toggle).toHaveAttribute('aria-pressed', 'true'); // Not muted = sounds on
    });
  });

  // --------------------------------------------------------------------------
  // Cancel Button
  // --------------------------------------------------------------------------
  describe('Cancel Button', () => {
    it('should call onCancel when Cancel button clicked', () => {
      const props = createDefaultProps();
      render(<DayCloseScannerBar {...props} />);
      fireEvent.click(screen.getByTestId('scanner-cancel-button'));
      expect(props.onCancel).toHaveBeenCalledTimes(1);
    });

    it('should be disabled when isSubmitting is true', () => {
      const props = createDefaultProps();
      render(<DayCloseScannerBar {...props} isSubmitting={true} />);
      expect(screen.getByTestId('scanner-cancel-button')).toBeDisabled();
    });

    it('should NOT be disabled when isSubmitting is false', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isSubmitting={false} />);
      expect(screen.getByTestId('scanner-cancel-button')).not.toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // Complete Button
  // --------------------------------------------------------------------------
  describe('Complete Button', () => {
    it('should call onComplete when Complete button clicked', () => {
      const props = createDefaultProps();
      props.scannedBins = [
        createScannedBin({ bin_id: 'b1' }),
        createScannedBin({ bin_id: 'b2', pack_number: '2345678' }),
        createScannedBin({ bin_id: 'b3', pack_number: '3456789' }),
      ];
      render(<DayCloseScannerBar {...props} />);
      fireEvent.click(screen.getByTestId('scanner-complete-button'));
      expect(props.onComplete).toHaveBeenCalledTimes(1);
    });

    it('should be disabled when NOT all bins are scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [createScannedBin({ bin_id: 'b1' })]; // Only 1 of 3
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByTestId('scanner-complete-button')).toBeDisabled();
    });

    it('should be enabled when all bins are scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [
        createScannedBin({ bin_id: 'b1' }),
        createScannedBin({ bin_id: 'b2', pack_number: '2345678' }),
        createScannedBin({ bin_id: 'b3', pack_number: '3456789' }),
      ];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByTestId('scanner-complete-button')).not.toBeDisabled();
    });

    it('should be disabled when isSubmitting is true even if all scanned', () => {
      const props = createDefaultProps();
      props.scannedBins = [
        createScannedBin({ bin_id: 'b1' }),
        createScannedBin({ bin_id: 'b2', pack_number: '2345678' }),
        createScannedBin({ bin_id: 'b3', pack_number: '3456789' }),
      ];
      render(<DayCloseScannerBar {...props} isSubmitting={true} />);
      expect(screen.getByTestId('scanner-complete-button')).toBeDisabled();
    });

    it('should show loader icon when isSubmitting', () => {
      const props = createDefaultProps();
      props.scannedBins = [
        createScannedBin({ bin_id: 'b1' }),
        createScannedBin({ bin_id: 'b2', pack_number: '2345678' }),
        createScannedBin({ bin_id: 'b3', pack_number: '3456789' }),
      ];
      render(<DayCloseScannerBar {...props} isSubmitting={true} />);
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('should respect isComplete override', () => {
      const props = createDefaultProps();
      props.scannedBins = []; // No scans, but override says complete
      render(<DayCloseScannerBar {...props} isComplete={true} />);
      expect(screen.getByTestId('scanner-complete-button')).not.toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // Scanner Input Callbacks
  // --------------------------------------------------------------------------
  describe('Scanner Input Callbacks', () => {
    it('should call onScan when valid scan occurs', () => {
      const props = createDefaultProps();
      render(<DayCloseScannerBar {...props} />);
      const input = screen.getByTestId('scanner-bar-input');

      fireEvent.change(input, { target: { value: 'VALID_SCAN' } });

      expect(props.onScan).toHaveBeenCalledWith('000112345670123456789012');
    });

    it('should call onScanError when scan error occurs', () => {
      const props = createDefaultProps();
      render(<DayCloseScannerBar {...props} />);
      const input = screen.getByTestId('scanner-bar-input');

      fireEvent.change(input, { target: { value: 'ERROR' } });

      expect(props.onScanError).toHaveBeenCalled();
    });

    it('should disable input when isSubmitting', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} isSubmitting={true} />);
      expect(screen.getByTestId('scanner-bar-input')).toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // Floating/Sticky Positioning
  // --------------------------------------------------------------------------
  describe('Floating/Sticky Positioning', () => {
    it('should have sticky positioning by default', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      const bar = screen.getByTestId('day-close-scanner-bar');
      expect(bar.className).toContain('sticky');
    });

    it('should have relative positioning when floating is false', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} floating={false} />);
      const bar = screen.getByTestId('day-close-scanner-bar');
      expect(bar.className).toContain('relative');
      expect(bar.className).not.toContain('sticky');
    });

    it('should have z-40 for proper stacking', () => {
      render(<DayCloseScannerBar {...createDefaultProps()} />);
      const bar = screen.getByTestId('day-close-scanner-bar');
      expect(bar.className).toContain('z-40');
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty bins array', () => {
      const props = createDefaultProps();
      props.bins = [];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByTestId('scanner-progress')).toHaveTextContent('0/0');
    });

    it('should handle all empty bins (no active packs)', () => {
      const props = createDefaultProps();
      props.bins = [
        createEmptyBin({ bin_id: 'e1', bin_number: 1 }),
        createEmptyBin({ bin_id: 'e2', bin_number: 2 }),
      ];
      render(<DayCloseScannerBar {...props} />);
      expect(screen.getByTestId('scanner-progress')).toHaveTextContent('0/0');
    });

    it('should complete button be disabled with 0 active bins', () => {
      const props = createDefaultProps();
      props.bins = [createEmptyBin()];
      props.scannedBins = [];
      render(<DayCloseScannerBar {...props} />);
      // 0/0 is considered incomplete
      expect(screen.getByTestId('scanner-complete-button')).toBeDisabled();
    });
  });
});
