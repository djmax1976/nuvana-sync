/**
 * EnhancedPackActivationForm Duplicate Detection Unit Tests
 *
 * Tests the duplicate detection logic for both inventory and onboarding packs:
 * - getPackIdentity utility function
 * - pendingPackIdentities Set management
 * - Duplicate blocking behavior
 *
 * Story: Lottery Onboarding UX Fix (BIZ-012-UX-FIX)
 *
 * Traceability:
 * - BIZ-012-UX-FIX: Fix false duplicate errors for onboarding packs
 * - SEC-014: INPUT_VALIDATION - Identity uses only validated system values
 * - ARCH-001: FE_COMPONENT_DESIGN - Component isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/EnhancedPackActivationForm.duplicate-detection
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// ============================================================================
// Unit Tests for getPackIdentity (Exported Function)
// ============================================================================

import { getPackIdentity } from '../../../../src/renderer/components/lottery/EnhancedPackActivationForm';

describe('getPackIdentity Utility Function', () => {
  // --------------------------------------------------------------------------
  // DD-001: Returns pack_id when present
  // --------------------------------------------------------------------------
  describe('DD-001: pack_id present (inventory packs)', () => {
    it('should return pack_id when pack_id is a valid UUID', () => {
      const pack = {
        pack_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        game_id: 'game-uuid-123',
        pack_number: '1234567',
      };

      expect(getPackIdentity(pack)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should return pack_id for any non-empty string pack_id', () => {
      const pack = {
        pack_id: 'some-pack-id',
        game_id: 'game-uuid-123',
        pack_number: '1234567',
      };

      expect(getPackIdentity(pack)).toBe('some-pack-id');
    });

    it('should prefer pack_id over game_id:pack_number even if both exist', () => {
      const pack = {
        pack_id: 'existing-pack-id',
        game_id: 'game-uuid-123',
        pack_number: '7777777',
      };

      const identity = getPackIdentity(pack);
      expect(identity).toBe('existing-pack-id');
      expect(identity).not.toContain(':');
    });
  });

  // --------------------------------------------------------------------------
  // DD-002: Returns game_id:pack_number when pack_id undefined
  // --------------------------------------------------------------------------
  describe('DD-002: pack_id undefined (onboarding packs)', () => {
    it('should return game_id:pack_number when pack_id is undefined', () => {
      const pack = {
        pack_id: undefined,
        game_id: 'game-uuid-123',
        pack_number: '1234567',
      };

      expect(getPackIdentity(pack)).toBe('game-uuid-123:1234567');
    });

    it('should handle different game_id formats', () => {
      const pack = {
        pack_id: undefined,
        game_id: 'abc-def-ghi-jkl',
        pack_number: '9999999',
      };

      expect(getPackIdentity(pack)).toBe('abc-def-ghi-jkl:9999999');
    });

    it('should handle short pack numbers', () => {
      const pack = {
        pack_id: undefined,
        game_id: 'game-id',
        pack_number: '001',
      };

      expect(getPackIdentity(pack)).toBe('game-id:001');
    });
  });

  // --------------------------------------------------------------------------
  // DD-003: Different inventory packs (different pack_ids) are NOT duplicates
  // --------------------------------------------------------------------------
  describe('DD-003: Different inventory packs', () => {
    it('should generate different identities for different pack_ids', () => {
      const pack1 = {
        pack_id: 'pack-id-001',
        game_id: 'same-game-id',
        pack_number: '1234567',
      };
      const pack2 = {
        pack_id: 'pack-id-002',
        game_id: 'same-game-id',
        pack_number: '1234567',
      };

      const identity1 = getPackIdentity(pack1);
      const identity2 = getPackIdentity(pack2);

      expect(identity1).not.toBe(identity2);
    });

    it('should allow same pack_number from different pack_ids', () => {
      const packSet = new Set<string>();

      const pack1 = { pack_id: 'uuid-1', game_id: 'game-1', pack_number: '1234567' };
      const pack2 = { pack_id: 'uuid-2', game_id: 'game-1', pack_number: '1234567' };

      packSet.add(getPackIdentity(pack1));
      expect(packSet.has(getPackIdentity(pack2))).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // DD-004: Different onboarding packs (different pack_numbers) are NOT duplicates
  // --------------------------------------------------------------------------
  describe('DD-004: Different onboarding packs', () => {
    it('should generate different identities for different pack_numbers', () => {
      const pack1 = {
        pack_id: undefined,
        game_id: 'game-uuid-123',
        pack_number: '1111111',
      };
      const pack2 = {
        pack_id: undefined,
        game_id: 'game-uuid-123',
        pack_number: '2222222',
      };

      const identity1 = getPackIdentity(pack1);
      const identity2 = getPackIdentity(pack2);

      expect(identity1).not.toBe(identity2);
      expect(identity1).toBe('game-uuid-123:1111111');
      expect(identity2).toBe('game-uuid-123:2222222');
    });

    it('should allow multiple onboarding packs from same game', () => {
      const packSet = new Set<string>();

      // Add first onboarding pack
      const pack1 = { pack_id: undefined, game_id: 'game-1', pack_number: '1234567' };
      packSet.add(getPackIdentity(pack1));
      expect(packSet.size).toBe(1);

      // Add second onboarding pack (different pack_number)
      const pack2 = { pack_id: undefined, game_id: 'game-1', pack_number: '7654321' };
      expect(packSet.has(getPackIdentity(pack2))).toBe(false);
      packSet.add(getPackIdentity(pack2));
      expect(packSet.size).toBe(2);

      // Add third onboarding pack (different pack_number)
      const pack3 = { pack_id: undefined, game_id: 'game-1', pack_number: '9999999' };
      expect(packSet.has(getPackIdentity(pack3))).toBe(false);
      packSet.add(getPackIdentity(pack3));
      expect(packSet.size).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // DD-005: Same onboarding pack (same game_id:pack_number) ARE duplicates
  // --------------------------------------------------------------------------
  describe('DD-005: Same onboarding pack (duplicate detection)', () => {
    it('should generate identical identity for same game_id:pack_number', () => {
      const pack1 = {
        pack_id: undefined,
        game_id: 'game-uuid-123',
        pack_number: '1234567',
      };
      const pack2 = {
        pack_id: undefined,
        game_id: 'game-uuid-123',
        pack_number: '1234567',
      };

      expect(getPackIdentity(pack1)).toBe(getPackIdentity(pack2));
    });

    it('should detect duplicate in Set', () => {
      const packSet = new Set<string>();

      const pack1 = { pack_id: undefined, game_id: 'game-1', pack_number: '1234567' };
      packSet.add(getPackIdentity(pack1));

      // Same pack scanned again
      const pack2 = { pack_id: undefined, game_id: 'game-1', pack_number: '1234567' };
      expect(packSet.has(getPackIdentity(pack2))).toBe(true);
    });

    it('should correctly block duplicate onboarding pack', () => {
      const pendingIdentities = new Set<string>();

      // First scan
      const firstPack = { pack_id: undefined, game_id: 'mega-millions', pack_number: '0001234' };
      const firstIdentity = getPackIdentity(firstPack);
      expect(pendingIdentities.has(firstIdentity)).toBe(false);
      pendingIdentities.add(firstIdentity);

      // Second scan of same pack (should be blocked)
      const duplicatePack = {
        pack_id: undefined,
        game_id: 'mega-millions',
        pack_number: '0001234',
      };
      const duplicateIdentity = getPackIdentity(duplicatePack);
      expect(pendingIdentities.has(duplicateIdentity)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // DD-006: Different games with same pack_number are NOT duplicates
  // --------------------------------------------------------------------------
  describe('DD-006: Different games, same pack_number', () => {
    it('should allow same pack_number from different games (onboarding)', () => {
      const packGame1 = {
        pack_id: undefined,
        game_id: 'mega-millions-uuid',
        pack_number: '1234567',
      };
      const packGame2 = {
        pack_id: undefined,
        game_id: 'powerball-uuid',
        pack_number: '1234567',
      };

      const identity1 = getPackIdentity(packGame1);
      const identity2 = getPackIdentity(packGame2);

      expect(identity1).not.toBe(identity2);
      expect(identity1).toBe('mega-millions-uuid:1234567');
      expect(identity2).toBe('powerball-uuid:1234567');
    });

    it('should track same pack_number across games independently', () => {
      const packSet = new Set<string>();

      // Pack from Game A
      const packA = { pack_id: undefined, game_id: 'game-A', pack_number: '0000001' };
      packSet.add(getPackIdentity(packA));

      // Pack from Game B with same pack_number
      const packB = { pack_id: undefined, game_id: 'game-B', pack_number: '0000001' };
      expect(packSet.has(getPackIdentity(packB))).toBe(false);
      packSet.add(getPackIdentity(packB));

      // Pack from Game C with same pack_number
      const packC = { pack_id: undefined, game_id: 'game-C', pack_number: '0000001' };
      expect(packSet.has(getPackIdentity(packC))).toBe(false);

      expect(packSet.size).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // DD-SEC-001: Security - Identity uses only validated system values
  // --------------------------------------------------------------------------
  describe('DD-SEC-001: Security - Validated System Values Only', () => {
    it('should not accept user input in identity (only system values)', () => {
      // This test verifies the function signature only accepts specific fields
      // that are validated by the system (game_id, pack_id, pack_number)
      const pack = {
        pack_id: undefined,
        game_id: 'validated-game-uuid',
        pack_number: '1234567',
        // Any additional fields like user_input should not affect identity
      };

      const identity = getPackIdentity(pack);

      // Identity should only contain game_id and pack_number
      expect(identity).toBe('validated-game-uuid:1234567');
      expect(identity).not.toContain('user');
      expect(identity).not.toContain('input');
    });

    it('should produce deterministic identity (no random/time-based components)', () => {
      const pack = {
        pack_id: undefined,
        game_id: 'game-123',
        pack_number: '0000001',
      };

      // Call multiple times - should always produce same result
      const identity1 = getPackIdentity(pack);
      const identity2 = getPackIdentity(pack);
      const identity3 = getPackIdentity(pack);

      expect(identity1).toBe(identity2);
      expect(identity2).toBe(identity3);
      expect(identity1).toBe('game-123:0000001');
    });

    it('should handle special characters in game_id safely', () => {
      // game_id is validated upstream as UUID, but test edge case
      const pack = {
        pack_id: undefined,
        game_id: 'game-with-special-chars',
        pack_number: '1234567',
      };

      const identity = getPackIdentity(pack);
      expect(identity).toBe('game-with-special-chars:1234567');
    });

    it('should use colon separator consistently', () => {
      const pack = {
        pack_id: undefined,
        game_id: 'abc',
        pack_number: 'def',
      };

      const identity = getPackIdentity(pack);
      expect(identity.split(':').length).toBe(2);
      expect(identity).toBe('abc:def');
    });
  });
});

// ============================================================================
// Component Integration Tests for Duplicate Detection
// ============================================================================

// Test Fixtures
function createMockPack(
  overrides: Partial<{
    pack_id: string | undefined;
    game_id: string;
    pack_number: string;
    scanned_serial: string;
    is_onboarding_pack: boolean;
  }> = {}
) {
  // IMPORTANT: Handle explicit undefined for pack_id (onboarding packs)
  // Use 'pack_id' in overrides check instead of ?? to properly handle undefined
  const pack_id = 'pack_id' in overrides ? overrides.pack_id : 'pack-uuid-123';

  return {
    pack_id,
    pack_number: overrides.pack_number ?? '1234567',
    game_id: overrides.game_id ?? 'game-uuid-456',
    game_name: 'Test Scratch Game',
    game_price: 5,
    serial_start: '000',
    serial_end: '299',
    game_status: 'ACTIVE' as const,
    scanned_serial: overrides.scanned_serial,
    is_onboarding_pack: overrides.is_onboarding_pack,
  };
}

function createMockBin(binNumber = 1) {
  return {
    bin_id: `bin-uuid-${binNumber}`,
    name: `Bin ${binNumber}`,
    bin_number: binNumber,
    pack: null,
  };
}

// Mock Dependencies
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
    React.useEffect(() => {
      if (props.open && props.pack) {
        onBinConfirmHandler = props.onConfirm;
      }
    }, [props.open, props.pack, props.onConfirm]);
    return props.open && props.pack ? (
      <div data-testid="bin-selection-modal">Mock Bin Modal</div>
    ) : null;
  },
}));

// Import Component Under Test (after mocks)
import { EnhancedPackActivationForm } from '../../../../src/renderer/components/lottery/EnhancedPackActivationForm';

// Helper Functions
async function waitForPackSelectHandler() {
  await waitFor(
    () => {
      expect(onPackSelectHandler).not.toBeNull();
    },
    { timeout: 2000 }
  );
}

async function selectPackAndConfirmBin(
  packOverrides?: Parameters<typeof createMockPack>[0],
  binNumber = 1
) {
  // Wait for handler to be available
  await waitForPackSelectHandler();

  // Clear bin confirm handler before triggering new selection
  onBinConfirmHandler = null;

  // Trigger pack selection
  await act(async () => {
    onPackSelectHandler!(createMockPack(packOverrides));
  });

  // Wait for bin modal to appear
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

  // Confirm bin selection
  await act(async () => {
    onBinConfirmHandler!(`bin-uuid-${binNumber}`, createMockBin(binNumber), false);
  });

  // Wait for modal to close (bin modal renders null when closed)
  await waitFor(
    () => {
      expect(screen.queryByTestId('bin-selection-modal')).not.toBeInTheDocument();
    },
    { timeout: 2000 }
  );
}

// Component Integration Tests
describe('EnhancedPackActivationForm Duplicate Detection (Component)', () => {
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
  // Onboarding Pack Duplicate Detection
  // --------------------------------------------------------------------------
  describe('Onboarding Pack Duplicate Detection (BIZ-012-UX-FIX)', () => {
    it('should block duplicate onboarding pack (same game_id:pack_number)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      // Add first onboarding pack
      await selectPackAndConfirmBin(
        {
          pack_id: undefined,
          game_id: 'game-uuid-1',
          pack_number: '1234567',
          is_onboarding_pack: true,
        },
        1
      );

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });

      // Clear the toast mock
      mockToast.mockClear();

      // Attempt to add same pack again (same game_id + pack_number)
      // Duplicate check happens BEFORE bin modal opens
      await waitForPackSelectHandler();

      await act(async () => {
        onPackSelectHandler!(
          createMockPack({
            pack_id: undefined,
            game_id: 'game-uuid-1',
            pack_number: '1234567',
            is_onboarding_pack: true,
          })
        );
      });

      // Should show duplicate error toast (block happens before modal)
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Pack Already Added',
            variant: 'destructive',
          })
        );
      });

      // Should NOT increase pending count
      expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
    });

    it('should NOT block different onboarding packs (different pack_numbers)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      // Add first onboarding pack
      await selectPackAndConfirmBin(
        {
          pack_id: undefined,
          game_id: 'game-uuid-1',
          pack_number: '1111111',
          is_onboarding_pack: true,
        },
        1
      );

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });

      mockToast.mockClear();

      // Attempt to add different pack (different pack_number) - should NOT be blocked
      await waitForPackSelectHandler();

      await act(async () => {
        onPackSelectHandler!(
          createMockPack({
            pack_id: undefined,
            game_id: 'game-uuid-1',
            pack_number: '2222222',
            is_onboarding_pack: true,
          })
        );
      });

      // Should NOT show duplicate error - pack is NOT a duplicate
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pack Already Added',
        })
      );

      // Bin modal should open (pack was NOT blocked)
      await waitFor(() => {
        expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
      });
    });

    it('should NOT block same pack_number from different games', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      // Add pack from game A
      await selectPackAndConfirmBin(
        {
          pack_id: undefined,
          game_id: 'mega-millions-uuid',
          pack_number: '1234567',
          is_onboarding_pack: true,
        },
        1
      );

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });

      mockToast.mockClear();

      // Attempt to add pack from game B with same pack_number - should NOT be blocked
      await waitForPackSelectHandler();

      await act(async () => {
        onPackSelectHandler!(
          createMockPack({
            pack_id: undefined,
            game_id: 'powerball-uuid',
            pack_number: '1234567',
            is_onboarding_pack: true,
          })
        );
      });

      // Should NOT show duplicate error - different game
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pack Already Added',
        })
      );

      // Bin modal should open (pack was NOT blocked)
      await waitFor(() => {
        expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Inventory Pack Duplicate Detection (Regression Test)
  // --------------------------------------------------------------------------
  describe('Inventory Pack Duplicate Detection (Regression)', () => {
    it('should block duplicate inventory pack (same pack_id)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      // Add first inventory pack
      await selectPackAndConfirmBin(
        {
          pack_id: 'inventory-pack-uuid-1',
          game_id: 'game-uuid-1',
          pack_number: '1234567',
        },
        1
      );

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });

      mockToast.mockClear();

      // Attempt to add same pack again
      await waitForPackSelectHandler();

      await act(async () => {
        onPackSelectHandler!(
          createMockPack({
            pack_id: 'inventory-pack-uuid-1',
            game_id: 'game-uuid-1',
            pack_number: '1234567',
          })
        );
      });

      // Should show duplicate error
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Pack Already Added',
            variant: 'destructive',
          })
        );
      });
    });

    it('should NOT block different inventory packs (different pack_ids)', async () => {
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={false}
        />
      );

      // Add first inventory pack
      await selectPackAndConfirmBin(
        {
          pack_id: 'pack-uuid-001',
          game_id: 'game-uuid-1',
          pack_number: '1234567',
        },
        1
      );

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });

      mockToast.mockClear();

      // Attempt to add different pack (different pack_id) - should NOT be blocked
      await waitForPackSelectHandler();

      await act(async () => {
        onPackSelectHandler!(
          createMockPack({
            pack_id: 'pack-uuid-002',
            game_id: 'game-uuid-1',
            pack_number: '7654321',
          })
        );
      });

      // Should NOT show duplicate error - different pack_id
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pack Already Added',
        })
      );

      // Bin modal should open
      await waitFor(() => {
        expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Critical Bug Regression Test
  // --------------------------------------------------------------------------
  describe('BIZ-012-UX-FIX: Original Bug Scenario', () => {
    it('should NOT create false duplicates when multiple onboarding packs have undefined pack_id', async () => {
      // This test verifies the original bug is fixed:
      // Before fix: All onboarding packs had pack_id=undefined, so Set contained {undefined}
      // and pendingPackIds.has(undefined) was true for ALL subsequent packs
      render(
        <EnhancedPackActivationForm
          storeId="store-uuid"
          open={true}
          onOpenChange={vi.fn()}
          onboardingMode={true}
        />
      );

      // Add first onboarding pack (pack_id = undefined)
      await selectPackAndConfirmBin(
        {
          pack_id: undefined,
          game_id: 'game-1',
          pack_number: '0000001',
          is_onboarding_pack: true,
        },
        1
      );

      await waitFor(() => {
        expect(screen.getByText('Pending Packs (1)')).toBeInTheDocument();
      });

      mockToast.mockClear();

      // Add second onboarding pack (also pack_id = undefined, but DIFFERENT pack_number)
      // BEFORE FIX: This would show false duplicate error because both have pack_id = undefined
      // AFTER FIX: This should NOT show duplicate error (different identity: game-1:0000002)
      await waitForPackSelectHandler();

      await act(async () => {
        onPackSelectHandler!(
          createMockPack({
            pack_id: undefined,
            game_id: 'game-1',
            pack_number: '0000002',
            is_onboarding_pack: true,
          })
        );
      });

      // Should NOT show duplicate error
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pack Already Added',
        })
      );

      // Bin modal should open (proves pack was NOT falsely blocked)
      await waitFor(() => {
        expect(screen.getByTestId('bin-selection-modal')).toBeInTheDocument();
      });
    });
  });
});

// ============================================================================
// Traceability Matrix
// ============================================================================

describe('Traceability: BIZ-012-UX-FIX Requirements', () => {
  it('should satisfy DD-001: getPackIdentity returns pack_id when present', () => {
    const pack = { pack_id: 'uuid-123', game_id: 'game', pack_number: '001' };
    expect(getPackIdentity(pack)).toBe('uuid-123');
  });

  it('should satisfy DD-002: getPackIdentity returns game_id:pack_number when pack_id undefined', () => {
    const pack = { pack_id: undefined, game_id: 'game', pack_number: '001' };
    expect(getPackIdentity(pack)).toBe('game:001');
  });

  it('should satisfy DD-003: Different inventory packs are NOT duplicates', () => {
    const pack1 = { pack_id: 'uuid-1', game_id: 'game', pack_number: '001' };
    const pack2 = { pack_id: 'uuid-2', game_id: 'game', pack_number: '001' };
    expect(getPackIdentity(pack1)).not.toBe(getPackIdentity(pack2));
  });

  it('should satisfy DD-004: Different onboarding packs are NOT duplicates', () => {
    const pack1 = { pack_id: undefined, game_id: 'game', pack_number: '001' };
    const pack2 = { pack_id: undefined, game_id: 'game', pack_number: '002' };
    expect(getPackIdentity(pack1)).not.toBe(getPackIdentity(pack2));
  });

  it('should satisfy DD-005: Same onboarding pack IS flagged as duplicate', () => {
    const pack1 = { pack_id: undefined, game_id: 'game', pack_number: '001' };
    const pack2 = { pack_id: undefined, game_id: 'game', pack_number: '001' };
    expect(getPackIdentity(pack1)).toBe(getPackIdentity(pack2));
  });

  it('should satisfy DD-006: Different games with same pack_number are NOT duplicates', () => {
    const pack1 = { pack_id: undefined, game_id: 'game-A', pack_number: '001' };
    const pack2 = { pack_id: undefined, game_id: 'game-B', pack_number: '001' };
    expect(getPackIdentity(pack1)).not.toBe(getPackIdentity(pack2));
  });

  it('should satisfy DD-SEC-001: Identity uses only validated system values', () => {
    const pack = { pack_id: undefined, game_id: 'validated', pack_number: '001' };
    const identity = getPackIdentity(pack);
    // Identity is deterministic and contains only the expected fields
    expect(identity).toBe('validated:001');
    expect(getPackIdentity(pack)).toBe(identity); // Deterministic
  });
});
