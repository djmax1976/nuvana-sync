/**
 * DayBinsTable Unit Tests
 *
 * Tests the DayBinsTable component for correct rendering of:
 * - Card header with "Day Bins" title and pack count badge
 * - BinBadge rendering for bin numbers
 * - Empty bin rows (greyed out)
 * - Table data columns: game name, price, pack #, starting, ending, sold, amount
 * - Manual entry mode: editable inputs, validation errors, action buttons
 * - Row click handling
 * - Empty state
 * - Scanner mode: green highlighting, checkmarks, click-to-undo
 * - Sold/Amount columns with real-time calculations
 * - Totals row with sum of tickets and amount
 * - BinActionsMenu integration (⋮ icon dropdown)
 *
 * Traceability:
 * - SEC-004: XSS prevention via JSX auto-escaping
 * - SEC-014: Input validation (3-digit numeric, max length)
 * - FE-002: Form validation on blur
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/DayBinsTable
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================================================
// Mock Dependencies
// ============================================================================

vi.mock('lucide-react', () => ({
  ChevronRight: (props: Record<string, unknown>) => <div data-testid="chevron-icon" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => (
    <div data-testid="check-circle-icon" {...props} />
  ),
  MoreVertical: (props: Record<string, unknown>) => (
    <div data-testid="more-vertical-icon" {...props} />
  ),
  Package: (props: Record<string, unknown>) => <div data-testid="package-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <div data-testid="rotate-ccw-icon" {...props} />,
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import { DayBinsTable } from '../../../../src/renderer/components/lottery/DayBinsTable';
import type { DayBin, DayBinPack } from '../../../../src/renderer/lib/api/lottery';
import type { ScannedBin } from '../../../../src/renderer/hooks/useScannedBins';

// ============================================================================
// Test Fixtures
// ============================================================================

function createPack(overrides: Partial<DayBinPack> = {}): DayBinPack {
  return {
    pack_id: 'pack-001',
    pack_number: 'PKG-001',
    game_name: 'Powerball',
    game_price: 30,
    starting_serial: '000',
    ending_serial: '004',
    serial_end: '029',
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

// ============================================================================
// Tests
// ============================================================================

describe('DayBinsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Empty State
  // --------------------------------------------------------------------------
  describe('Empty State', () => {
    it('should show empty message when bins array is empty', () => {
      render(<DayBinsTable bins={[]} />);
      expect(screen.getByTestId('day-bins-table-empty')).toBeInTheDocument();
      expect(screen.getByText('No bins configured for this store.')).toBeInTheDocument();
    });

    it('should handle null bins gracefully', () => {
      render(<DayBinsTable bins={null as unknown as DayBin[]} />);
      expect(screen.getByTestId('day-bins-table-empty')).toBeInTheDocument();
    });

    it('should handle undefined bins gracefully', () => {
      render(<DayBinsTable bins={undefined as unknown as DayBin[]} />);
      expect(screen.getByTestId('day-bins-table-empty')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Card Header
  // --------------------------------------------------------------------------
  describe('Card Header', () => {
    it('should render the table with data-testid', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByTestId('day-bins-table')).toBeInTheDocument();
    });

    it('should display "Bins" title', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('Bins')).toBeInTheDocument();
    });

    it('should render header with blue icon', () => {
      render(
        <DayBinsTable
          bins={[
            createBin({ bin_id: 'b1' }),
            createBin({ bin_id: 'b2', bin_number: 2 }),
            createEmptyBin({ bin_id: 'b3' }),
          ]}
        />
      );
      const card = screen.getByTestId('day-bins-table');
      const icon = card.querySelector('.bg-blue-100');
      expect(icon).not.toBeNull();
    });

    it('should render "Bins" title when all bins are empty', () => {
      render(
        <DayBinsTable
          bins={[
            createEmptyBin({ bin_id: 'b1', bin_number: 1 }),
            createEmptyBin({ bin_id: 'b2', bin_number: 2 }),
          ]}
        />
      );
      expect(screen.getByText('Bins')).toBeInTheDocument();
    });

    it('should have rounded card styling', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      const card = screen.getByTestId('day-bins-table');
      expect(card.className).toContain('rounded-2xl');
      expect(card.className).toContain('border');
      expect(card.className).toContain('shadow-sm');
    });

    it('should render grid icon in card header', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      const card = screen.getByTestId('day-bins-table');
      const svg = card.querySelector('svg');
      expect(svg).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Table Column Headers
  // --------------------------------------------------------------------------
  describe('Table Column Headers', () => {
    it('should render column headers: Bin, Game, Price, Pack #, Start, End, Actions', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('Bin')).toBeInTheDocument();
      expect(screen.getByText('Game')).toBeInTheDocument();
      expect(screen.getByText('Price')).toBeInTheDocument();
      expect(screen.getByText('Pack #')).toBeInTheDocument();
      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.getByText('End')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('should have uppercase styling on column headers', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      const headers = screen.getAllByRole('columnheader');
      headers.forEach((header) => {
        expect(header.className).toContain('uppercase');
        expect(header.className).toContain('tracking-wider');
      });
    });
  });

  // --------------------------------------------------------------------------
  // BinBadge Rendering
  // --------------------------------------------------------------------------
  describe('BinBadge Rendering', () => {
    it('should render BinBadge for each bin', () => {
      render(
        <DayBinsTable
          bins={[
            createBin({ bin_id: 'b1', bin_number: 1 }),
            createBin({ bin_id: 'b2', bin_number: 7, pack: createPack({ pack_id: 'p2' }) }),
          ]}
        />
      );
      const table = screen.getByTestId('day-bins-table');
      const badges = table.querySelectorAll('span[class*="bg-blue-100"][class*="text-blue-700"]');
      expect(badges.length).toBe(2);
      expect(badges[0].textContent).toBe('1');
      expect(badges[1].textContent).toBe('7');
    });

    it('should render BinBadge for empty bins too', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} />);
      const table = screen.getByTestId('day-bins-table');
      const badge = table.querySelector('span[class*="bg-blue-100"][class*="text-blue-700"]');
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe('5');
    });
  });

  // --------------------------------------------------------------------------
  // Pack Data Display
  // --------------------------------------------------------------------------
  describe('Pack Data Display', () => {
    it('should display game name for populated bins', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('Powerball')).toBeInTheDocument();
    });

    it('should display "(Empty)" for empty bins', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} />);
      expect(screen.getByText('(Empty)')).toBeInTheDocument();
    });

    it('should display pack price', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('$30.00')).toBeInTheDocument();
    });

    it('should display "--" for price on empty bins', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} />);
      const row = screen.getByTestId('day-bins-row-bin-empty');
      expect(row.textContent).toContain('--');
    });

    it('should display pack number', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('PKG-001')).toBeInTheDocument();
    });

    it('should display starting serial', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('000')).toBeInTheDocument();
    });

    it('should display ending serial when not in manual entry mode', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByTestId('ending-display-bin-001')).toBeInTheDocument();
      expect(screen.getByTestId('ending-display-bin-001').textContent).toBe('004');
    });

    it('should dim empty bin rows', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} />);
      const row = screen.getByTestId('day-bins-row-bin-empty');
      expect(row.className).toContain('opacity-50');
    });
  });

  // --------------------------------------------------------------------------
  // Row Sorting
  // --------------------------------------------------------------------------
  describe('Row Sorting', () => {
    it('should sort bins by bin_number ascending', () => {
      render(
        <DayBinsTable
          bins={[
            createBin({ bin_id: 'b3', bin_number: 3 }),
            createBin({ bin_id: 'b1', bin_number: 1, pack: createPack({ pack_id: 'p1' }) }),
            createBin({ bin_id: 'b2', bin_number: 2, pack: createPack({ pack_id: 'p2' }) }),
          ]}
        />
      );
      const badges = screen
        .getByTestId('day-bins-table')
        .querySelectorAll('span[class*="bg-blue-100"][class*="text-blue-700"]');
      expect(badges[0].textContent).toBe('1');
      expect(badges[1].textContent).toBe('2');
      expect(badges[2].textContent).toBe('3');
    });
  });

  // --------------------------------------------------------------------------
  // Row Click
  // --------------------------------------------------------------------------
  describe('Row Click', () => {
    it('should call onRowClick with pack_id when non-empty row is clicked', () => {
      const onRowClick = vi.fn();
      render(<DayBinsTable bins={[createBin()]} onRowClick={onRowClick} />);
      fireEvent.click(screen.getByTestId('day-bins-row-bin-001'));
      expect(onRowClick).toHaveBeenCalledWith('pack-001');
    });

    it('should NOT call onRowClick for empty bins', () => {
      const onRowClick = vi.fn();
      render(<DayBinsTable bins={[createEmptyBin()]} onRowClick={onRowClick} />);
      fireEvent.click(screen.getByTestId('day-bins-row-bin-empty'));
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should have cursor-pointer on clickable rows', () => {
      const onRowClick = vi.fn();
      render(<DayBinsTable bins={[createBin()]} onRowClick={onRowClick} />);
      const row = screen.getByTestId('day-bins-row-bin-001');
      expect(row.className).toContain('cursor-pointer');
    });

    it('should NOT call onRowClick in manual entry mode', () => {
      const onRowClick = vi.fn();
      render(<DayBinsTable bins={[createBin()]} onRowClick={onRowClick} manualEntryMode={true} />);
      fireEvent.click(screen.getByTestId('day-bins-row-bin-001'));
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Manual Entry Mode
  // --------------------------------------------------------------------------
  describe('Manual Entry Mode', () => {
    it('should show input fields for non-empty bins in manual entry mode', () => {
      render(<DayBinsTable bins={[createBin()]} manualEntryMode={true} />);
      expect(screen.getByTestId('ending-input-bin-001')).toBeInTheDocument();
    });

    it('should NOT show input fields for empty bins', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} manualEntryMode={true} />);
      expect(screen.queryByTestId('ending-input-bin-empty')).not.toBeInTheDocument();
    });

    it('should show "(Edit)" label on End column header', () => {
      render(<DayBinsTable bins={[createBin()]} manualEntryMode={true} />);
      expect(screen.getByText('(Edit)')).toBeInTheDocument();
    });

    it('should strip non-numeric characters from input', () => {
      const onEndingChange = vi.fn();
      render(
        <DayBinsTable bins={[createBin()]} manualEntryMode={true} onEndingChange={onEndingChange} />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      fireEvent.change(input, { target: { value: 'abc123' } });
      expect(onEndingChange).toHaveBeenCalledWith('bin-001', '123');
    });

    it('should truncate input to 3 digits', () => {
      const onEndingChange = vi.fn();
      render(
        <DayBinsTable bins={[createBin()]} manualEntryMode={true} onEndingChange={onEndingChange} />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      fireEvent.change(input, { target: { value: '12345' } });
      expect(onEndingChange).toHaveBeenCalledWith('bin-001', '123');
    });

    it('should call onInputComplete when 3 digits entered', () => {
      const onInputComplete = vi.fn();
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          onInputComplete={onInputComplete}
          onEndingChange={vi.fn()}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      fireEvent.change(input, { target: { value: '029' } });
      expect(onInputComplete).toHaveBeenCalledWith('bin-001');
    });

    it('should show ending value from endingValues prop', () => {
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          endingValues={{ 'bin-001': '015' }}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001') as HTMLInputElement;
      expect(input.value).toBe('015');
    });

    it('should have numeric input attributes', () => {
      render(<DayBinsTable bins={[createBin()]} manualEntryMode={true} />);
      const input = screen.getByTestId('ending-input-bin-001') as HTMLInputElement;
      expect(input.getAttribute('inputMode')).toBe('numeric');
      expect(input.getAttribute('pattern')).toBe('[0-9]*');
      expect(input.getAttribute('maxLength')).toBe('3');
    });

    it('should have aria-label for accessibility', () => {
      render(<DayBinsTable bins={[createBin()]} manualEntryMode={true} />);
      const input = screen.getByTestId('ending-input-bin-001');
      expect(input).toHaveAttribute('aria-label', 'Ending serial for bin 1');
    });
  });

  // --------------------------------------------------------------------------
  // Validation Errors
  // --------------------------------------------------------------------------
  describe('Validation Errors', () => {
    it('should display error message when validationErrors has entry', () => {
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          validationErrors={{
            'bin-001': { message: 'Serial out of range' },
          }}
        />
      );
      expect(screen.getByTestId('ending-error-bin-001')).toBeInTheDocument();
      expect(screen.getByText('Serial out of range')).toBeInTheDocument();
    });

    it('should apply red styling to input with error', () => {
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          validationErrors={{
            'bin-001': { message: 'Invalid' },
          }}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      expect(input.className).toContain('border-red-500');
    });

    it('should set aria-invalid on input with error', () => {
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          validationErrors={{
            'bin-001': { message: 'Error' },
          }}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('should apply green styling for complete 3-digit input', () => {
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          endingValues={{ 'bin-001': '029' }}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      expect(input.className).toContain('border-green-500');
    });

    it('should call onValidateEnding on blur with 3-digit value', () => {
      const onValidateEnding = vi.fn();
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          endingValues={{ 'bin-001': '025' }}
          onValidateEnding={onValidateEnding}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      fireEvent.blur(input);
      expect(onValidateEnding).toHaveBeenCalledWith('bin-001', '025', {
        starting_serial: '000',
        serial_end: '029',
      });
    });

    it('should NOT call onValidateEnding on blur with < 3 digits', () => {
      const onValidateEnding = vi.fn();
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          endingValues={{ 'bin-001': '02' }}
          onValidateEnding={onValidateEnding}
        />
      );
      const input = screen.getByTestId('ending-input-bin-001');
      fireEvent.blur(input);
      expect(onValidateEnding).not.toHaveBeenCalled();
    });

    it('should have role="alert" on error message', () => {
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          validationErrors={{
            'bin-001': { message: 'Out of range' },
          }}
        />
      );
      const error = screen.getByTestId('ending-error-bin-001');
      expect(error).toHaveAttribute('role', 'alert');
    });
  });

  // --------------------------------------------------------------------------
  // Actions Menu (BinActionsMenu Integration)
  // --------------------------------------------------------------------------
  describe('Actions Menu', () => {
    it('should show actions menu trigger for non-empty bins', () => {
      render(<DayBinsTable bins={[createBin()]} onReturnPack={vi.fn()} />);
      expect(screen.getByTestId('bin-bin-001-actions-menu-trigger')).toBeInTheDocument();
    });

    it('should show "--" for empty bins instead of actions menu', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} onReturnPack={vi.fn()} />);
      expect(screen.queryByTestId('bin-bin-empty-actions-menu-trigger')).not.toBeInTheDocument();
    });

    it('should have aria-label on actions menu trigger', () => {
      render(<DayBinsTable bins={[createBin()]} onReturnPack={vi.fn()} />);
      const trigger = screen.getByTestId('bin-bin-001-actions-menu-trigger');
      expect(trigger).toHaveAttribute('aria-label', 'Actions for pack PKG-001');
    });

    it('should open menu on trigger click', async () => {
      const user = userEvent.setup();
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          onMarkSoldOut={vi.fn()}
          onReturnPack={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should show Mark Sold option when onMarkSoldOut is provided (regardless of manual entry mode)', async () => {
      const user = userEvent.setup();
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={false}
          onMarkSoldOut={vi.fn()}
          onReturnPack={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should show Mark Sold option in manual entry mode when onMarkSoldOut is provided', async () => {
      const user = userEvent.setup();
      render(
        <DayBinsTable
          bins={[createBin()]}
          manualEntryMode={true}
          onMarkSoldOut={vi.fn()}
          onReturnPack={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should NOT show Mark Sold option when onMarkSoldOut is NOT provided', async () => {
      const user = userEvent.setup();
      render(<DayBinsTable bins={[createBin()]} manualEntryMode={false} onReturnPack={vi.fn()} />);

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.queryByText('Mark Sold')).not.toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should show only Return when onMarkSoldOut is NOT provided even in manual entry mode', async () => {
      const user = userEvent.setup();
      render(<DayBinsTable bins={[createBin()]} manualEntryMode={true} onReturnPack={vi.fn()} />);

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.queryByText('Mark Sold')).not.toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should show Mark Sold option in scanner mode when onMarkSoldOut is provided', async () => {
      const user = userEvent.setup();
      render(
        <DayBinsTable
          bins={[createBin()]}
          scannerModeActive={true}
          onMarkSoldOut={vi.fn()}
          onReturnPack={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should call onMarkSoldOut with pack_id when Mark Sold is clicked', async () => {
      const onMarkSoldOut = vi.fn();
      const user = userEvent.setup();
      render(
        <DayBinsTable bins={[createBin()]} onMarkSoldOut={onMarkSoldOut} onReturnPack={vi.fn()} />
      );

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));
      await waitFor(() => expect(screen.getByText('Mark Sold')).toBeInTheDocument());
      await user.click(screen.getByTestId('bin-bin-001-mark-sold-menu-item'));

      expect(onMarkSoldOut).toHaveBeenCalledWith('pack-001');
      expect(onMarkSoldOut).toHaveBeenCalledTimes(1);
    });

    it('should call onReturnPack with pack_id when Return is clicked', async () => {
      const onReturnPack = vi.fn();
      const user = userEvent.setup();
      render(
        <DayBinsTable bins={[createBin()]} onMarkSoldOut={vi.fn()} onReturnPack={onReturnPack} />
      );

      await user.click(screen.getByTestId('bin-bin-001-actions-menu-trigger'));
      await waitFor(() => expect(screen.getByText('Return')).toBeInTheDocument());
      await user.click(screen.getByTestId('bin-bin-001-return-menu-item'));

      expect(onReturnPack).toHaveBeenCalledWith('pack-001');
      expect(onReturnPack).toHaveBeenCalledTimes(1);
    });

    it('should show "--" placeholder when neither callback is provided for non-empty bin', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      // When no callbacks, BinActionsMenu renders "--" instead of trigger
      expect(screen.queryByTestId('bin-bin-001-actions-menu-trigger')).not.toBeInTheDocument();
    });

    it('should show actions menu for multiple bins with different packs', async () => {
      const user = userEvent.setup();
      const bins = [
        createBin({
          bin_id: 'b1',
          bin_number: 1,
          pack: createPack({ pack_id: 'p1', pack_number: 'PKG-001' }),
        }),
        createBin({
          bin_id: 'b2',
          bin_number: 2,
          pack: createPack({ pack_id: 'p2', pack_number: 'PKG-002' }),
        }),
      ];
      render(<DayBinsTable bins={bins} onMarkSoldOut={vi.fn()} onReturnPack={vi.fn()} />);

      // Both bins should have action menu triggers
      expect(screen.getByTestId('bin-b1-actions-menu-trigger')).toBeInTheDocument();
      expect(screen.getByTestId('bin-b2-actions-menu-trigger')).toBeInTheDocument();

      // First bin menu should work
      await user.click(screen.getByTestId('bin-b1-actions-menu-trigger'));
      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Sold Column
  // --------------------------------------------------------------------------
  describe('Sold Column', () => {
    it('should render "Sold" column header', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('Sold')).toBeInTheDocument();
    });

    it('should display "--" for empty bins', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} />);
      const soldCell = screen.getByTestId('sold-bin-empty');
      expect(soldCell.textContent).toBe('--');
    });

    it('should display "--" when no ending serial exists', () => {
      const binWithoutEnding = createBin({
        pack: createPack({ ending_serial: null }),
      });
      render(<DayBinsTable bins={[binWithoutEnding]} />);
      const soldCell = screen.getByTestId('sold-bin-001');
      expect(soldCell.textContent).toBe('--');
    });

    it('should calculate tickets sold correctly (end - start)', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: '015',
        }),
      });
      render(<DayBinsTable bins={[bin]} />);
      const soldCell = screen.getByTestId('sold-bin-001');
      expect(soldCell.textContent).toBe('15');
    });

    it('should update calculation when manual ending is entered', () => {
      const bin = createBin({
        pack: createPack({ ending_serial: null }),
      });
      render(
        <DayBinsTable bins={[bin]} manualEntryMode={true} endingValues={{ 'bin-001': '020' }} />
      );
      const soldCell = screen.getByTestId('sold-bin-001');
      expect(soldCell.textContent).toBe('20');
    });

    it('should display "--" when ending < starting', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '015',
          ending_serial: '010', // Invalid: end < start
        }),
      });
      render(<DayBinsTable bins={[bin]} />);
      const soldCell = screen.getByTestId('sold-bin-001');
      expect(soldCell.textContent).toBe('--');
    });
  });

  // --------------------------------------------------------------------------
  // Amount Column
  // --------------------------------------------------------------------------
  describe('Amount Column', () => {
    it('should render "Amount" column header', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      expect(screen.getByText('Amount')).toBeInTheDocument();
    });

    it('should display "--" for empty bins', () => {
      render(<DayBinsTable bins={[createEmptyBin()]} />);
      const amountCell = screen.getByTestId('amount-bin-empty');
      expect(amountCell.textContent).toBe('--');
    });

    it('should display "--" when no ending serial exists', () => {
      const binWithoutEnding = createBin({
        pack: createPack({ ending_serial: null }),
      });
      render(<DayBinsTable bins={[binWithoutEnding]} />);
      const amountCell = screen.getByTestId('amount-bin-001');
      expect(amountCell.textContent).toBe('--');
    });

    it('should calculate amount correctly (sold × price)', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: '015',
          game_price: 30, // $30 per ticket
        }),
      });
      render(<DayBinsTable bins={[bin]} />);
      const amountCell = screen.getByTestId('amount-bin-001');
      // 15 tickets × $30 = $450.00
      expect(amountCell.textContent).toBe('$450.00');
    });

    it('should format amount as currency with 2 decimals', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: '003',
          game_price: 2.5, // $2.50 per ticket
        }),
      });
      render(<DayBinsTable bins={[bin]} />);
      const amountCell = screen.getByTestId('amount-bin-001');
      // 3 tickets × $2.50 = $7.50
      expect(amountCell.textContent).toBe('$7.50');
    });
  });

  // --------------------------------------------------------------------------
  // Totals Row
  // --------------------------------------------------------------------------
  describe('Totals Row', () => {
    it('should display totals row when bins have ending serials', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: '015',
          game_price: 10,
        }),
      });
      render(<DayBinsTable bins={[bin]} />);
      expect(screen.getByTestId('totals-row')).toBeInTheDocument();
    });

    it('should NOT display totals row when no tickets sold', () => {
      const bin = createBin({
        pack: createPack({ ending_serial: null }),
      });
      render(<DayBinsTable bins={[bin]} />);
      expect(screen.queryByTestId('totals-row')).not.toBeInTheDocument();
    });

    it('should show "Total:" label in normal mode', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: '015',
        }),
      });
      render(<DayBinsTable bins={[bin]} />);
      expect(screen.getByText('Total:')).toBeInTheDocument();
    });

    it('should display correct total tickets', () => {
      const bin1 = createBin({
        bin_id: 'b1',
        bin_number: 1,
        pack: createPack({
          pack_id: 'p1',
          starting_serial: '000',
          ending_serial: '010', // 10 tickets
          game_price: 5,
        }),
      });
      const bin2 = createBin({
        bin_id: 'b2',
        bin_number: 2,
        pack: createPack({
          pack_id: 'p2',
          starting_serial: '000',
          ending_serial: '005', // 5 tickets
          game_price: 10,
        }),
      });
      render(<DayBinsTable bins={[bin1, bin2]} />);
      const totalTickets = screen.getByTestId('total-tickets');
      expect(totalTickets.textContent).toBe('15'); // 10 + 5
    });

    it('should display correct total amount', () => {
      const bin1 = createBin({
        bin_id: 'b1',
        bin_number: 1,
        pack: createPack({
          pack_id: 'p1',
          starting_serial: '000',
          ending_serial: '010', // 10 tickets × $5 = $50
          game_price: 5,
        }),
      });
      const bin2 = createBin({
        bin_id: 'b2',
        bin_number: 2,
        pack: createPack({
          pack_id: 'p2',
          starting_serial: '000',
          ending_serial: '005', // 5 tickets × $10 = $50
          game_price: 10,
        }),
      });
      render(<DayBinsTable bins={[bin1, bin2]} />);
      const totalAmount = screen.getByTestId('total-amount');
      expect(totalAmount.textContent).toBe('$100.00'); // $50 + $50
    });
  });

  // --------------------------------------------------------------------------
  // Row ID Attributes
  // --------------------------------------------------------------------------
  describe('Row ID Attributes', () => {
    it('should add id attribute to each row for auto-scroll', () => {
      render(<DayBinsTable bins={[createBin()]} />);
      const row = screen.getByTestId('day-bins-row-bin-001');
      expect(row).toHaveAttribute('id', 'bin-row-bin-001');
    });

    it('should have unique id for each bin row', () => {
      const bins = [
        createBin({ bin_id: 'b1', bin_number: 1 }),
        createBin({ bin_id: 'b2', bin_number: 2, pack: createPack({ pack_id: 'p2' }) }),
      ];
      render(<DayBinsTable bins={bins} />);
      expect(document.getElementById('bin-row-b1')).toBeInTheDocument();
      expect(document.getElementById('bin-row-b2')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Scanner Mode Visual Feedback
  // --------------------------------------------------------------------------
  describe('Scanner Mode Visual Feedback', () => {
    function createScannedBin(binId: string, overrides: Partial<ScannedBin> = {}): ScannedBin {
      return {
        bin_id: binId,
        bin_number: 1,
        pack_id: 'pack-001',
        pack_number: 'PKG-001',
        game_name: 'Powerball',
        closing_serial: '015',
        ...overrides,
      };
    }

    it('should apply green background to scanned rows', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      const row = screen.getByTestId('day-bins-row-bin-001');
      expect(row.className).toContain('bg-green-50');
    });

    it('should apply pulse animation to last scanned row', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(
        <DayBinsTable
          bins={[bin]}
          scannedBins={[scannedBin]}
          lastScannedBinId="bin-001"
          scannerModeActive={true}
        />
      );
      const row = screen.getByTestId('day-bins-row-bin-001');
      expect(row.className).toContain('animate-pulse');
    });

    it('should NOT apply pulse animation to non-last scanned rows', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(
        <DayBinsTable
          bins={[bin]}
          scannedBins={[scannedBin]}
          lastScannedBinId="other-bin-id"
          scannerModeActive={true}
        />
      );
      const row = screen.getByTestId('day-bins-row-bin-001');
      expect(row.className).not.toContain('animate-pulse');
    });

    it('should show checkmark icon for scanned bins', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      expect(screen.getByTestId('check-circle-icon')).toBeInTheDocument();
    });

    it('should display scanned closing serial with checkmark', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001', { closing_serial: '025' });
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      const scannedSerial = screen.getByTestId('scanned-serial-bin-001');
      expect(scannedSerial.textContent).toContain('025');
    });

    it('should have cursor-pointer on scanned rows when onUndoScan provided', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(
        <DayBinsTable
          bins={[bin]}
          scannedBins={[scannedBin]}
          scannerModeActive={true}
          onUndoScan={vi.fn()}
        />
      );
      const row = screen.getByTestId('day-bins-row-bin-001');
      expect(row.className).toContain('cursor-pointer');
    });

    it('should call onUndoScan when scanned row is clicked', () => {
      const onUndoScan = vi.fn();
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(
        <DayBinsTable
          bins={[bin]}
          scannedBins={[scannedBin]}
          scannerModeActive={true}
          onUndoScan={onUndoScan}
        />
      );
      fireEvent.click(screen.getByTestId('day-bins-row-bin-001'));
      expect(onUndoScan).toHaveBeenCalledWith('bin-001');
    });

    it('should NOT call onRowClick when scanned row is clicked in scanner mode', () => {
      const onRowClick = vi.fn();
      const onUndoScan = vi.fn();
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001');
      render(
        <DayBinsTable
          bins={[bin]}
          scannedBins={[scannedBin]}
          scannerModeActive={true}
          onRowClick={onRowClick}
          onUndoScan={onUndoScan}
        />
      );
      fireEvent.click(screen.getByTestId('day-bins-row-bin-001'));
      expect(onRowClick).not.toHaveBeenCalled();
      expect(onUndoScan).toHaveBeenCalled();
    });

    it('should use scanned serial for Sold calculation', () => {
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: null,
        }),
      });
      const scannedBin = createScannedBin('bin-001', { closing_serial: '020' });
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      const soldCell = screen.getByTestId('sold-bin-001');
      expect(soldCell.textContent).toBe('20');
    });

    it('should show "Scanned Total:" label in scanner mode', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001', { closing_serial: '015' });
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      expect(screen.getByText('Scanned Total:')).toBeInTheDocument();
    });

    it('should apply green styling to Sold column for scanned bins', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001', { closing_serial: '015' });
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      const soldCell = screen.getByTestId('sold-bin-001');
      expect(soldCell.className).toContain('text-green-700');
    });

    it('should apply green styling to Amount column for scanned bins', () => {
      const bin = createBin();
      const scannedBin = createScannedBin('bin-001', { closing_serial: '015' });
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      const amountCell = screen.getByTestId('amount-bin-001');
      expect(amountCell.className).toContain('text-green-700');
    });

    it('should apply sold-out formula when is_sold_out is true', () => {
      // Sold-out formula: (end - start) + 1
      // Normal formula: end - start
      const bin = createBin({
        pack: createPack({
          starting_serial: '000',
          ending_serial: null,
        }),
      });
      const scannedBin = createScannedBin('bin-001', {
        closing_serial: '029',
        is_sold_out: true,
      });
      render(<DayBinsTable bins={[bin]} scannedBins={[scannedBin]} scannerModeActive={true} />);
      const soldCell = screen.getByTestId('sold-bin-001');
      // Sold out: 29 - 0 + 1 = 30 tickets
      expect(soldCell.textContent).toBe('30');
    });
  });
});
