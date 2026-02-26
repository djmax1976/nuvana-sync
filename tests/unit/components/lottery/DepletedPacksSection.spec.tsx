/**
 * DepletedPacksSection Unit Tests
 *
 * Tests the DepletedPacksSection component for correct rendering of:
 * - Section header with title, count, and currency badge
 * - Collapsible expand/collapse behavior
 * - Pack rows with BinBadge, game data, tickets sold, sales amount
 * - Multi-day warning alert
 * - Date/time parsing and display
 * - Edge cases: empty data, invalid fields
 *
 * Traceability:
 * - SEC-004: XSS prevention via JSX auto-escaping
 * - SEC-014: Type-safe props with defensive null checks
 * - API-008: Only whitelisted fields displayed
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/DepletedPacksSection
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

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

import { DepletedPacksSection } from '../../../../src/renderer/components/lottery/DepletedPacksSection';
import type { DepletedPackDay, OpenBusinessPeriod } from '../../../../src/renderer/lib/api/lottery';

// ============================================================================
// Test Fixtures
// ============================================================================

function createPack(overrides: Partial<DepletedPackDay> = {}): DepletedPackDay {
  return {
    pack_id: 'dep-001',
    pack_number: 'PKG-DEP-001',
    game_name: 'Cash 5',
    game_price: 10,
    bin_number: 2,
    activated_at: '2026-02-02T08:00:00Z',
    depleted_at: '2026-02-02T18:00:00Z',
    starting_serial: '000',
    closing_serial: '029',
    tickets_sold_count: 30,
    sales_amount: 300,
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

describe('DepletedPacksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Null/Empty Guard (SEC-014)
  // --------------------------------------------------------------------------
  describe('Empty State Guard', () => {
    it('should return null for empty array', () => {
      const { container } = render(<DepletedPacksSection depletedPacks={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('should return null for null input', () => {
      const { container } = render(
        <DepletedPacksSection depletedPacks={null as unknown as DepletedPackDay[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should return null for undefined input', () => {
      const { container } = render(
        <DepletedPacksSection depletedPacks={undefined as unknown as DepletedPackDay[]} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Section Header
  // --------------------------------------------------------------------------
  describe('Section Header', () => {
    it('should render with data-testid', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} />);
      expect(screen.getByTestId('depleted-packs-section')).toBeInTheDocument();
    });

    it('should display title with count', () => {
      render(
        <DepletedPacksSection depletedPacks={[createPack(), createPack({ pack_id: 'dep-002' })]} />
      );
      expect(screen.getByText('Packs Sold Out (2)')).toBeInTheDocument();
    });

    it('should display total sales as currency badge', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[
            createPack({ pack_id: 'p1', sales_amount: 300 }),
            createPack({ pack_id: 'p2', sales_amount: 200 }),
          ]}
        />
      );
      expect(screen.getByText('$500.00')).toBeInTheDocument();
    });

    it('should have foreground styling on the currency badge', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} />);
      // Multiple elements may contain $300.00 (header badge + table cell)
      // Get the badge from the header (first occurrence, which is in the button area)
      const badges = screen.getAllByText('$300.00');
      const headerBadge = badges[0];
      expect(headerBadge.className).toContain('text-foreground');
    });
  });

  // --------------------------------------------------------------------------
  // Section Title Variants
  // --------------------------------------------------------------------------
  describe('Section Title Variants', () => {
    it('should show "Packs Sold Out - Current Period" when multiple days since close', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ days_since_last_close: 3 })}
        />
      );
      expect(screen.getByText('Packs Sold Out - Current Period (1)')).toBeInTheDocument();
    });

    it('should show "Packs Sold Out" for first period', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ is_first_period: true })}
        />
      );
      expect(screen.getByText('Packs Sold Out (1)')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Multi-Day Warning
  // --------------------------------------------------------------------------
  describe('Multi-Day Warning', () => {
    it('should show warning when days_since_last_close > 1', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({
            days_since_last_close: 3,
            last_closed_date: '2026-01-30',
          })}
        />
      );
      const warning = screen.getByTestId('multi-day-warning');
      expect(warning).toBeInTheDocument();
      expect(warning.textContent).toContain('3 days');
      expect(warning.textContent).toContain('last closed: 2026-01-30');
    });

    it('should NOT show warning when days_since_last_close is 1', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ days_since_last_close: 1 })}
        />
      );
      expect(screen.queryByTestId('multi-day-warning')).not.toBeInTheDocument();
    });

    it('should NOT show warning when no openBusinessPeriod', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} />);
      expect(screen.queryByTestId('multi-day-warning')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Collapse / Expand
  // Note: CSS Grid animation keeps content in DOM; collapsed state uses grid-rows-[0fr]
  // --------------------------------------------------------------------------
  describe('Collapse / Expand', () => {
    it('should be collapsed by default (grid-rows-[0fr])', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} />);
      // Content is always in DOM with CSS Grid animation
      const content = screen.getByTestId('depleted-packs-content');
      expect(content).toBeInTheDocument();
      // Parent grid wrapper has collapsed state
      const section = screen.getByTestId('depleted-packs-section');
      const gridWrapper = section.querySelector('.grid-rows-\\[0fr\\]');
      expect(gridWrapper).not.toBeNull();
    });

    it('should expand on click (grid-rows-[1fr])', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('depleted-packs-content')).toBeInTheDocument();
      const section = screen.getByTestId('depleted-packs-section');
      const gridWrapper = section.querySelector('.grid-rows-\\[1fr\\]');
      expect(gridWrapper).not.toBeNull();
    });

    it('should start expanded when defaultOpen=true', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByTestId('depleted-packs-content')).toBeInTheDocument();
    });

    it('should have correct aria-expanded toggle', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} />);
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
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('depleted-packs-content');
      const binBadge = section.querySelector('span[class*="bg-blue-100"]');
      expect(binBadge!.textContent).toBe('2');
    });

    it('should display game name', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('Cash 5')).toBeInTheDocument();
    });

    it('should display game price as currency', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('$10.00')).toBeInTheDocument();
    });

    it('should display pack number', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('PKG-DEP-001')).toBeInTheDocument();
    });

    it('should display tickets sold count', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('30')).toBeInTheDocument();
    });

    it('should display sales amount in the Amount cell', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      // Amount is in the last cell (index 7)
      const cells = row.querySelectorAll('td');
      expect(cells[7].textContent).toContain('$300.00');
    });

    it('should display sold-out date in Amount cell', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ depleted_at: '2026-02-02T18:00:00Z' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      // Amount is in the last cell (index 7), date is stacked below
      const cells = row.querySelectorAll('td');
      expect(cells[7].textContent).toMatch(/Feb/);
    });

    it('should display Start column with starting_serial from data', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      const cells = row.querySelectorAll('td');
      // Start column is the 5th cell (index 4)
      expect(cells[4].textContent).toBe('000');
    });

    it('should display custom starting_serial (e.g., onboarding pack)', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ starting_serial: '023' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      const cells = row.querySelectorAll('td');
      // Start column should show the actual starting_serial, not hardcoded 000
      expect(cells[4].textContent).toBe('023');
    });

    it('should display -- when starting_serial is null', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ starting_serial: null })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      const cells = row.querySelectorAll('td');
      expect(cells[4].textContent).toBe('--');
    });

    it('should display End column with closing_serial', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ closing_serial: '029' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      const cells = row.querySelectorAll('td');
      // End column is the 6th cell (index 5)
      expect(cells[5].textContent).toBe('029');
    });

    it('should have violet hover on rows', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      expect(row.className).toContain('hover:bg-violet-50');
    });

    it('should render row with data-testid', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByTestId('depleted-pack-row-dep-001')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Start/End Columns
  // --------------------------------------------------------------------------
  describe('Start/End Columns', () => {
    it('should display "Start" and "End" column headers', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.getByText('End')).toBeInTheDocument();
    });

    it('should show "--" for End when closing_serial is null (SEC-014: no silent fallbacks)', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ closing_serial: null as unknown as string })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      const cells = row.querySelectorAll('td');
      // End column is the 6th cell (index 5)
      // SEC-014: Missing data displays '--' indicator, not fake '000' value
      expect(cells[5].textContent).toBe('--');
    });

    it('should show "--" for End when closing_serial is empty string (SEC-014: no silent fallbacks)', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ closing_serial: '' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      const cells = row.querySelectorAll('td');
      // SEC-014: Empty string displays '--' indicator, not fake '000' value
      expect(cells[5].textContent).toBe('--');
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should show "--" for invalid depleted_at', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ depleted_at: 'not-a-date' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('depleted-pack-row-dep-001');
      // Amount is in the last cell (index 7), date portion should show "--"
      const cells = row.querySelectorAll('td');
      expect(cells[7].textContent).toContain('--');
    });

    it('should show "--" for non-number tickets_sold_count', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[createPack({ tickets_sold_count: null as unknown as number })]}
          defaultOpen={true}
        />
      );
      const section = screen.getByTestId('depleted-packs-content');
      expect(section.textContent).toContain('--');
    });

    it('should skip packs with invalid pack_id', () => {
      render(
        <DepletedPacksSection
          depletedPacks={[
            createPack({ pack_id: 'valid' }),
            { pack_id: 123 as unknown as string } as unknown as DepletedPackDay,
          ]}
          defaultOpen={true}
        />
      );
      const rows = screen.getAllByTestId(/depleted-pack-row/);
      expect(rows.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have aria-label on table region', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute('aria-label', 'Sold out packs table');
    });

    it('should have column headers with scope="col"', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const headers = screen.getAllByRole('columnheader');
      headers.forEach((header) => {
        expect(header).toHaveAttribute('scope', 'col');
      });
    });
  });

  // --------------------------------------------------------------------------
  // CSS Grid Animation (350ms smooth transition)
  // Traceability: PERF-002, ensures smooth UX via CSS Grid technique
  // --------------------------------------------------------------------------
  describe('CSS Grid Animation', () => {
    it('should have CSS Grid animation wrapper with grid class', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('depleted-packs-section');
      const animationWrapper = section.querySelector('.grid.transition-\\[grid-template-rows\\]');
      expect(animationWrapper).not.toBeNull();
    });

    it('should have 350ms duration class on animation wrapper', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('depleted-packs-section');
      const animationWrapper = section.querySelector('.duration-\\[350ms\\]');
      expect(animationWrapper).not.toBeNull();
    });

    it('should have ease-out timing function on animation wrapper', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('depleted-packs-section');
      const animationWrapper = section.querySelector('.ease-out');
      expect(animationWrapper).not.toBeNull();
    });

    it('should have grid-rows-[1fr] when open', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('depleted-packs-section');
      const animationWrapper = section.querySelector('.grid-rows-\\[1fr\\]');
      expect(animationWrapper).not.toBeNull();
    });

    it('should have grid-rows-[0fr] when closed', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={false} />);
      const section = screen.getByTestId('depleted-packs-section');
      const animationWrapper = section.querySelector('.grid-rows-\\[0fr\\]');
      expect(animationWrapper).not.toBeNull();
    });

    it('should have overflow-hidden inner wrapper for animation', () => {
      render(<DepletedPacksSection depletedPacks={[createPack()]} defaultOpen={true} />);
      const section = screen.getByTestId('depleted-packs-section');
      const gridWrapper = section.querySelector('.grid');
      const overflowWrapper = gridWrapper?.querySelector('.overflow-hidden');
      expect(overflowWrapper).not.toBeNull();
    });
  });
});
