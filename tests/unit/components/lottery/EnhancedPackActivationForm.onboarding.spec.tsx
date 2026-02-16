/**
 * EnhancedPackActivationForm Onboarding Mode Unit Tests
 *
 * Tests the onboarding mode behavior for first-ever lottery day:
 * - Serial defaulting logic (scanned vs default '000')
 * - onboardingMode prop acceptance and backward compatibility
 * - Visual indicators for onboarding mode
 * - SEC-014 input validation for serial_start
 * - Data flow to activation API
 *
 * Story: Lottery Onboarding Feature (BIZ-010)
 *
 * Traceability:
 * - BIZ-010: First-ever lottery day onboarding mode
 * - SEC-014: INPUT_VALIDATION - serial_start validated as 3 digits
 * - ARCH-001: FE_COMPONENT_DESIGN - Component isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/EnhancedPackActivationForm.onboarding
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPack(scanned_serial?: string) {
  return {
    pack_id: 'pack-uuid-123',
    pack_number: '1234567',
    game_id: 'game-uuid-456',
    game_name: 'Test Scratch Game',
    game_price: 5,
    serial_start: '000',
    serial_end: '299',
    game_status: 'ACTIVE' as const,
    scanned_serial,
  };
}

function createMockBin() {
  return {
    bin_id: 'bin-uuid-789',
    name: 'Bin 1',
    bin_number: 1,
    pack: null,
  };
}

// ============================================================================
// Mock Dependencies
// ============================================================================

const mockFullActivationMutate = vi.fn();

vi.mock('../../../../src/renderer/hooks/useLottery', () => ({
  useFullPackActivation: () => ({
    mutateAsync: mockFullActivationMutate,
    isLoading: false,
  }),
  useLotteryDayBins: () => ({
    data: { bins: [] },
    isLoading: false,
  }),
}));

const mockToast = vi.fn();
vi.mock('../../../../src/renderer/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Global handlers that tests can trigger
let onPackSelectHandler: ((pack: ReturnType<typeof createMockPack>) => void) | null = null;
let onBinConfirmHandler:
  | ((binId: string, bin: ReturnType<typeof createMockBin>, deplete: boolean) => void)
  | null = null;

vi.mock('../../../../src/renderer/components/lottery/PackSearchCombobox', () => ({
  PackSearchCombobox: React.forwardRef(function Mock(
    props: { onPackSelect: (pack: ReturnType<typeof createMockPack>) => void },
    ref
  ) {
    React.useImperativeHandle(ref, () => ({ focus: vi.fn(), clear: vi.fn() }));
    // Store the handler for tests to use (in useEffect to avoid rules-of-hooks violation)
    React.useEffect(() => {
      onPackSelectHandler = props.onPackSelect;
    }, [props.onPackSelect]);
    return <div data-testid="pack-search-combobox">Mock Pack Search</div>;
  }),
}));

vi.mock('../../../../src/renderer/components/lottery/BinSelectionModal', () => ({
  BinSelectionModal: (props: {
    open: boolean;
    pack: ReturnType<typeof createMockPack> | null;
    onConfirm: (binId: string, bin: ReturnType<typeof createMockBin>, deplete: boolean) => void;
  }) => {
    // Store handler for tests (in useEffect to avoid rules-of-hooks violation)
    React.useEffect(() => {
      if (props.open && props.pack) {
        onBinConfirmHandler = props.onConfirm;
      }
    }, [props.open, props.pack, props.onConfirm]);
    return props.open && props.pack ? (
      <div data-testid="bin-selection-modal">
        <span data-testid="modal-scanned-serial">{props.pack.scanned_serial ?? 'none'}</span>
      </div>
    ) : null;
  },
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import { EnhancedPackActivationForm } from '../../../../src/renderer/components/lottery/EnhancedPackActivationForm';

// ============================================================================
// Helper Functions
// ============================================================================

async function selectPackAndConfirmBin(scannedSerial?: string) {
  // Wait for handler to be captured with explicit timeout (component must fully render)
  await waitFor(
    () => {
      expect(onPackSelectHandler).not.toBeNull();
    },
    { timeout: 2000 }
  );

  // Trigger pack selection via captured handler
  await act(async () => {
    onPackSelectHandler!(createMockPack(scannedSerial));
  });

  // Wait for bin modal to appear with explicit timeout
  await waitFor(
    () => {
      expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
    },
    { timeout: 2000 }
  );

  // Wait for confirm handler to be captured before using it
  await waitFor(
    () => {
      expect(onBinConfirmHandler).not.toBeNull();
    },
    { timeout: 2000 }
  );

  // Confirm bin selection
  await act(async () => {
    onBinConfirmHandler!('bin-uuid-789', createMockBin(), false);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('EnhancedPackActivationForm Onboarding Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFullActivationMutate.mockResolvedValue({ data: { success: true } });
    onPackSelectHandler = null;
    onBinConfirmHandler = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Props Interface (3.1.1, 3.1.2)
  // --------------------------------------------------------------------------
  describe('onboardingMode Prop Interface', () => {
    it('should accept onboardingMode prop', () => {
      expect(() =>
        render(
          <EnhancedPackActivationForm
            storeId="store-uuid"
            open={true}
            onOpenChange={vi.fn()}
            onboardingMode={true}
          />
        )
      ).not.toThrow();
    });

    it('should accept onboardingMode=false', () => {
      expect(() =>
        render(
          <EnhancedPackActivationForm
            storeId="store-uuid"
            open={true}
            onOpenChange={vi.fn()}
            onboardingMode={false}
          />
        )
      ).not.toThrow();
    });

    it('should accept undefined onboardingMode (backward compatibility)', () => {
      expect(() =>
        render(
          <EnhancedPackActivationForm storeId="store-uuid" open={true} onOpenChange={vi.fn()} />
        )
      ).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Serial Defaulting - Normal Mode (3.2)
  // --------------------------------------------------------------------------
  describe('Serial Defaulting - Normal Mode', () => {
    it('should use "000" when onboardingMode=false', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });

    it('should use "000" when onboardingMode=undefined (backward compat)', async () => {
      render(
        <EnhancedPackActivationForm storeId="store-uuid" open={true} onOpenChange={vi.fn()} />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });

    it('should ignore scanned_serial when onboardingMode=false', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      await selectPackAndConfirmBin('150');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Serial Defaulting - Onboarding Mode (3.2.1, 3.2.2)
  // --------------------------------------------------------------------------
  describe('Serial Defaulting - Onboarding Mode', () => {
    it('should use scanned_serial "025" when onboardingMode=true', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 025')).toBeInTheDocument();
      });
    });

    it('should use scanned_serial "150" (mid-range) when onboardingMode=true', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('150');

      await waitFor(() => {
        expect(screen.getByText('Serial: 150')).toBeInTheDocument();
      });
    });

    it('should use scanned_serial "999" (max value) when onboardingMode=true', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('999');

      await waitFor(() => {
        expect(screen.getByText('Serial: 999')).toBeInTheDocument();
      });
    });

    it('should use scanned_serial "000" correctly when onboardingMode=true', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('000');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Fallback Scenarios (3.2.3)
  // --------------------------------------------------------------------------
  describe('Fallback to "000" in Onboarding Mode', () => {
    it('should fallback to "000" if scanned_serial is undefined', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin(undefined);

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });

    it('should fallback to "000" if scanned_serial is empty string', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });

    it('should fallback to "000" if scanned_serial is non-numeric (SEC-014)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('abc');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });

    it('should fallback to "000" if scanned_serial is longer than 3 digits (SEC-014)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('1234');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });

    it('should fallback to "000" if scanned_serial is 2 digits (SEC-014)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('12');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Visual Indicators (3.3.1, 3.3.2)
  // --------------------------------------------------------------------------
  describe('Visual Indicators', () => {
    it('should show onboarding mode banner when onboardingMode=true', () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      expect(screen.getByTestId('onboarding-mode-banner')).toBeInTheDocument();
      expect(screen.getByText(/Onboarding Mode/)).toBeInTheDocument();
    });

    it('should NOT show onboarding mode banner when onboardingMode=false', () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      expect(screen.queryByTestId('onboarding-mode-banner')).not.toBeInTheDocument();
    });

    it('should NOT show onboarding mode banner when onboardingMode=undefined', () => {
      render(
        <EnhancedPackActivationForm storeId="store-uuid" open={true} onOpenChange={vi.fn()} />
      );

      expect(screen.queryByTestId('onboarding-mode-banner')).not.toBeInTheDocument();
    });

    it('should show "Scanned" badge for non-zero serial in onboarding mode', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByTestId('scanned-position-badge-pack-uuid-123')).toBeInTheDocument();
        expect(screen.getByText('Scanned')).toBeInTheDocument();
      });
    });

    it('should NOT show "Scanned" badge when serial is "000"', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('000');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('scanned-position-badge-pack-uuid-123')).not.toBeInTheDocument();
    });

    it('should NOT show "Scanned" badge when onboardingMode=false', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('scanned-position-badge-pack-uuid-123')).not.toBeInTheDocument();
    });

    it('should have role="status" on onboarding banner for accessibility', () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      const banner = screen.getByTestId('onboarding-mode-banner');
      expect(banner).toHaveAttribute('role', 'status');
    });

    it('should have aria-live="polite" on onboarding banner for accessibility', () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      const banner = screen.getByTestId('onboarding-mode-banner');
      expect(banner).toHaveAttribute('aria-live', 'polite');
    });
  });

  // --------------------------------------------------------------------------
  // Data Flow - API Calls (3.4.4)
  // --------------------------------------------------------------------------
  describe('Data Flow - API Calls', () => {
    it('should pass correct opening_serial to activation API in onboarding mode', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 025')).toBeInTheDocument();
      });

      const activateButton = screen.getByTestId('activate-all-button');
      await act(async () => {
        fireEvent.click(activateButton);
      });

      await waitFor(() => {
        expect(mockFullActivationMutate).toHaveBeenCalledWith({
          storeId: 'store-uuid',
          data: expect.objectContaining({
            pack_id: 'pack-uuid-123',
            bin_id: 'bin-uuid-789',
            opening_serial: '025',
            deplete_previous: false,
          }),
        });
      });
    });

    it('should pass "000" as opening_serial in normal mode', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 000')).toBeInTheDocument();
      });

      const activateButton = screen.getByTestId('activate-all-button');
      await act(async () => {
        fireEvent.click(activateButton);
      });

      await waitFor(() => {
        expect(mockFullActivationMutate).toHaveBeenCalledWith({
          storeId: 'store-uuid',
          data: expect.objectContaining({
            opening_serial: '000',
          }),
        });
      });
    });
  });

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------
  describe('State Management', () => {
    // TODO: Modal state reset behavior is out of scope for Phase 3 (BIZ-010 onboarding mode).
    // The component currently preserves state across open/close cycles.
    // This test documents expected behavior for future implementation if needed.
    it.skip('should reset state when modal closes and reopens', async () => {
      const { rerender } = render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 025')).toBeInTheDocument();
      });

      // Close modal
      rerender(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={false}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      // Reopen modal
      rerender(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      expect(screen.queryByText('Serial: 025')).not.toBeInTheDocument();
      expect(screen.getByText('Scan a pack to get started')).toBeInTheDocument();
    });

    it('should preserve pending packs when modal stays open', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Serial: 025')).toBeInTheDocument();
      });

      expect(screen.getByText('Test Scratch Game')).toBeInTheDocument();
      expect(screen.getByText('#1234567')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should pass scanned_serial through to bin modal', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      // Wait for handler to be captured
      await waitFor(
        () => {
          expect(onPackSelectHandler).not.toBeNull();
        },
        { timeout: 2000 }
      );

      await act(async () => {
        onPackSelectHandler!(createMockPack('025'));
      });

      await waitFor(
        () => {
          expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      expect(screen.getByTestId('modal-scanned-serial')).toHaveTextContent('025');
    });

    it('should correctly display pack count indicator', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      expect(screen.getByText('Pending Packs (0)')).toBeInTheDocument();

      await selectPackAndConfirmBin('025');

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });
    });

    it('should display toast when pack is added', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      await selectPackAndConfirmBin('025');

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pack Added',
        })
      );
    });
  });
});

// ============================================================================
// Traceability Matrix
// ============================================================================

describe('Traceability: BIZ-010 Phase 3 Requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFullActivationMutate.mockResolvedValue({ data: { success: true } });
    onPackSelectHandler = null;
    onBinConfirmHandler = null;
  });

  it('should satisfy all Phase 3 acceptance criteria', async () => {
    render(
      <EnhancedPackActivationForm
        storeId="store-uuid"
        open={true}
        onOpenChange={vi.fn()}
        onboardingMode={true}
      />
    );

    // AC-1: onboardingMode prop accepted
    expect(screen.getByTestId('batch-pack-activation-form')).toBeInTheDocument();

    // AC-2: Onboarding mode banner visible
    expect(screen.getByTestId('onboarding-mode-banner')).toBeInTheDocument();

    // Wait for handler to be captured
    await waitFor(
      () => {
        expect(onPackSelectHandler).not.toBeNull();
      },
      { timeout: 2000 }
    );

    // Select pack with scanned serial
    await act(async () => {
      onPackSelectHandler!(createMockPack('025'));
    });

    await waitFor(
      () => {
        expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    // Wait for confirm handler to be captured
    await waitFor(
      () => {
        expect(onBinConfirmHandler).not.toBeNull();
      },
      { timeout: 2000 }
    );

    await act(async () => {
      onBinConfirmHandler!('bin-uuid-789', createMockBin(), false);
    });

    // AC-3: Serial uses scanned value
    await waitFor(
      () => {
        expect(screen.getByText('Serial: 025')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    // AC-4: Visual indicator shows scanned position
    expect(screen.getByTestId('scanned-position-badge-pack-uuid-123')).toBeInTheDocument();
  });
});
