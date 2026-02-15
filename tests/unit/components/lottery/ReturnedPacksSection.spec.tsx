/**
 * ReturnedPacksSection Unit Tests
 *
 * Tests the ReturnedPacksSection component for correct rendering of:
 * - Section header with title, count, and currency badge
 * - Collapsible expand/collapse behavior
 * - Pack rows with BinBadge, return reason badges, sales data
 * - Multi-day warning alert
 * - Date/time parsing and display
 * - Edge cases: empty data, invalid fields, null return reasons
 *
 * Traceability:
 * - SEC-004: XSS prevention via JSX auto-escaping
 * - SEC-014: Type-safe props, constrained return reason lookup
 * - API-008: Only whitelisted fields displayed
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/ReturnedPacksSection
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

vi.mock('lucide-react', () => ({
  RotateCcw: (props: Record<string, unknown>) => <div data-testid="rotate-ccw-icon" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => (
    <div data-testid="alert-triangle-icon" {...props} />
  ),
  ChevronRight: (props: Record<string, unknown>) => <div data-testid="chevron-icon" {...props} />,
}));

vi.mock('../../../../src/renderer/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatCustom: (date: Date | string, fmt: string) => {
      const d = typeof date === 'string' ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
      if (fmt === 'MMM') return d.toLocaleString('en-US', { month: 'short' });
      if (fmt === 'd') return String(d.getDate());
      if (fmt === 'yyyy') return String(d.getFullYear());
      if (fmt === 'h:mm a')
        return d.toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
      if (fmt === 'MMM d, h:mm a') {
        const month = d.toLocaleString('en-US', { month: 'short' });
        const day = d.getDate();
        const time = d.toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        return `${month} ${day}, ${time}`;
      }
      return d.toISOString();
    },
    timezone: 'America/Denver',
  }),
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import { ReturnedPacksSection } from '../../../../src/renderer/components/lottery/ReturnedPacksSection';
import type { ReturnedPackDay, OpenBusinessPeriod } from '../../../../src/renderer/lib/api/lottery';

// ============================================================================
// Test Fixtures
// ============================================================================

function createPack(overrides: Partial<ReturnedPackDay> = {}): ReturnedPackDay {
  return {
    pack_id: 'ret-001',
    pack_number: 'PKG-RET-001',
    game_name: 'Mega Millions',
    game_price: 20,
    bin_number: 3,
    activated_at: '2026-02-02T08:00:00Z',
    returned_at: '2026-02-02T19:00:00Z',
    return_reason: 'DAMAGED',
    return_notes: 'Water damage on corner',
    last_sold_serial: '005',
    tickets_sold_on_return: 5,
    return_sales_amount: 100,
    returned_by_name: 'John Doe',
    ...overrides,
  };
}

function createOpenPeriod(overrides: Partial<OpenBusinessPeriod> = {}): OpenBusinessPeriod {
  return {
    started_at: '2026-02-02T08:00:00Z',
    last_closed_date: '2026-02-01',
    days_since_last_close: 1,
    is_first_period: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ReturnedPacksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Null/Empty Guard (SEC-014)
  // --------------------------------------------------------------------------
  describe('Empty State Guard', () => {
    it('should return null for empty array', () => {
      const { container } = render(<ReturnedPacksSection returnedPacks={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('should return null for null input', () => {
      const { container } = render(
        <ReturnedPacksSection returnedPacks={null as unknown as ReturnedPackDay[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should return null for undefined input', () => {
      const { container } = render(
        <ReturnedPacksSection returnedPacks={undefined as unknown as ReturnedPackDay[]} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Section Header
  // --------------------------------------------------------------------------
  describe('Section Header', () => {
    it('should render with data-testid', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} />);
      expect(screen.getByTestId('returned-packs-section')).toBeInTheDocument();
    });

    it('should display title with count', () => {
      render(
        <ReturnedPacksSection returnedPacks={[createPack(), createPack({ pack_id: 'ret-002' })]} />
      );
      expect(screen.getByText('Returned Packs (2)')).toBeInTheDocument();
    });

    it('should render orange SectionIcon with RotateCcw icon', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} />);
      expect(screen.getByTestId('rotate-ccw-icon')).toBeInTheDocument();
    });

    it('should display total return sales as orange currency badge', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[
            createPack({ pack_id: 'p1', return_sales_amount: 100 }),
            createPack({ pack_id: 'p2', return_sales_amount: 50 }),
          ]}
        />
      );
      expect(screen.getByText('$150.00')).toBeInTheDocument();
    });

    it('should have foreground styling on the currency badge', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} />);
      const badge = screen.getByText('$100.00');
      expect(badge.className).toContain('text-foreground');
    });

    it('should NOT show currency badge when total return sales is 0', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack({ return_sales_amount: 0 })]} />);
      // No currency badge when total is 0 — rightBadge is undefined
      expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Section Title Variants
  // --------------------------------------------------------------------------
  describe('Section Title Variants', () => {
    it('should show "Returned Packs - Current Period" when multiple days since close', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ days_since_last_close: 3 })}
        />
      );
      expect(screen.getByText('Returned Packs - Current Period (1)')).toBeInTheDocument();
    });

    it('should show "Returned Packs" for first period', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ is_first_period: true })}
        />
      );
      expect(screen.getByText('Returned Packs (1)')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Multi-Day Warning
  // --------------------------------------------------------------------------
  describe('Multi-Day Warning', () => {
    it('should show warning when days_since_last_close > 1', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({
            days_since_last_close: 5,
            last_closed_date: '2026-01-28',
          })}
        />
      );
      const warning = screen.getByTestId('multi-day-return-warning');
      expect(warning).toBeInTheDocument();
      expect(warning.textContent).toContain('5 days');
      expect(warning.textContent).toContain('last closed: 2026-01-28');
    });

    it('should NOT show warning when days_since_last_close is 1', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ days_since_last_close: 1 })}
        />
      );
      expect(screen.queryByTestId('multi-day-return-warning')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Collapse / Expand
  // --------------------------------------------------------------------------
  describe('Collapse / Expand', () => {
    it('should be collapsed by default', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} />);
      expect(screen.queryByTestId('returned-packs-content')).not.toBeInTheDocument();
    });

    it('should expand on click', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('returned-packs-content')).toBeInTheDocument();
    });

    it('should start expanded when defaultOpen=true', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByTestId('returned-packs-content')).toBeInTheDocument();
    });

    it('should have correct aria-expanded toggle', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // --------------------------------------------------------------------------
  // Pack Row Data
  // --------------------------------------------------------------------------
  describe('Pack Row Data', () => {
    it('should render BinBadge with bin number', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('returned-packs-content');
      const binBadge = section.querySelector('span[class*="bg-blue-100"]');
      expect(binBadge!.textContent).toBe('3');
    });

    it('should display game name', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('Mega Millions')).toBeInTheDocument();
    });

    it('should display game price as currency', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('$20.00')).toBeInTheDocument();
    });

    it('should display pack number', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('PKG-RET-001')).toBeInTheDocument();
    });

    it('should display tickets sold on return', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should display return sales in the Amount cell', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('returned-pack-row-ret-001');
      // Amount is in the last cell (index 7)
      const cells = row.querySelectorAll('td');
      expect(cells[7].textContent).toContain('$100.00');
    });

    it('should display returned date and time in Amount cell', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('returned-pack-row-ret-001');
      // Amount is in the last cell (index 7), date is stacked below
      const cells = row.querySelectorAll('td');
      expect(cells[7].textContent).toContain('$100.00');
      expect(cells[7].textContent).toMatch(/Feb/);
    });

    it('should display Start column with 000', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('returned-pack-row-ret-001');
      const cells = row.querySelectorAll('td');
      // Start column is the 5th cell (index 4)
      expect(cells[4].textContent).toBe('000');
    });

    it('should display End column with last_sold_serial', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack({ last_sold_serial: '005' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('returned-pack-row-ret-001');
      const cells = row.querySelectorAll('td');
      // End column is the 6th cell (index 5)
      expect(cells[5].textContent).toBe('005');
    });

    it('should have orange hover on rows', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('returned-pack-row-ret-001');
      expect(row.className).toContain('hover:bg-orange-50');
    });
  });

  // --------------------------------------------------------------------------
  // Start/End Columns
  // --------------------------------------------------------------------------
  describe('Start/End Columns', () => {
    it('should display "Start" and "End" column headers', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.getByText('End')).toBeInTheDocument();
    });

    it('should show "000" for End when last_sold_serial is null', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack({ last_sold_serial: null })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('returned-pack-row-ret-001');
      const cells = row.querySelectorAll('td');
      // End column is the 6th cell (index 5)
      expect(cells[5].textContent).toBe('000');
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should show "--" for invalid returned_at', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack({ returned_at: 'invalid' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('returned-pack-row-ret-001');
      // Amount is in the last cell (index 7), date portion should show "--"
      const cells = row.querySelectorAll('td');
      expect(cells[7].textContent).toContain('--');
    });

    it('should show "--" for non-number tickets_sold_on_return', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[createPack({ tickets_sold_on_return: null as unknown as number })]}
          defaultOpen={true}
        />
      );
      const section = screen.getByTestId('returned-packs-content');
      expect(section.textContent).toContain('--');
    });

    it('should skip packs with invalid pack_id', () => {
      render(
        <ReturnedPacksSection
          returnedPacks={[
            createPack({ pack_id: 'valid' }),
            { pack_id: 456 as unknown as string } as unknown as ReturnedPackDay,
          ]}
          defaultOpen={true}
        />
      );
      const rows = screen.getAllByTestId(/returned-pack-row/);
      expect(rows.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have aria-label on table region', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute('aria-label', 'Returned packs table');
    });

    it('should have column headers with scope="col"', () => {
      render(<ReturnedPacksSection returnedPacks={[createPack()]} defaultOpen={true} />);
      const headers = screen.getAllByRole('columnheader');
      headers.forEach((header) => {
        expect(header).toHaveAttribute('scope', 'col');
      });
    });
  });
});
